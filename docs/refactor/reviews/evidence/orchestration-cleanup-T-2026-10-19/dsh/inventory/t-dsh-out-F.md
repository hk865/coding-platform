# T 轮测试清点 · F 区（tests/helpers，110 个文件、34,420 行）

只读清点，未改仓库、未跑测试/构建/类型检查。依据：HANDOFF 决定 79（尤其 79-1、79-4，`docs/refactor/HANDOFF.md:563-604`）、`AGENTS.md` 规则 3/4/9、`.dsh-ref/t-common.md`。

## 结论摘要

- F 区 110 个 helper 全部至少被一个测试或 helper import，没有整文件可删；问题集中在 **复制粘贴的 fixture 基座**（S5 四份约 1,800 行、S1 第二份 claim+B2 约 390 行）、**手写事实**（S5 治理记录、scope seed、C1 的 RunSnapshot、executed-files 替身）和 **325 个无人 import 的 export**（82 个文件，多为同文件内部使用却带 export）。
- 按决定 79-1 的旧格式候选 4 类、5 个 helper（SP 的 4B-era FTS、S1/S2C-L 的旧 wire Session、S5 的 legacyNoticeWire、graph-session 的无 catalog baseline）；其中 NR05/NR08 是冻结规格行，只建议 keep-note。
- 只发现 1 处典型“只为篡改”：`graph-session-fixture.ts` 的 `seedTamperedArchitectureBaseline`。
- 两个此前怀疑的大重复经复核**不成立**：S2B timeline/track（171/891 行匹配，无 ≥20 行连续块）、S2A W2/openManyTaskWorld（47/322 行匹配，无 ≥15 行块），均列 keep-note。

## 逐条清单

| 编号 | 类别 | 位置 | 证据 | 建议 | 被谁覆盖 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---|---|---|
| F-01 | duplicate | tests/helpers/S5R2-c-support.ts:1-1081（另见 tests/helpers/S5-goal-settings-support.ts:1-791、tests/helpers/S5R2-d-support.ts:1-952） | difflib 逐行匹配：S5R2-c 与 S5-decision 相同 719/1082 行，S5R2-d 794/953，S5-goal-settings 721/792；三份文件头自认 copy（S5R2-c:1-9、S5R2-d:1-4、S5-goal-settings:1-2）；seedCommit 在 S5-decision:517-537、goal:226-246、c:263-283、d:293-313 四份逐行相同（21 行）；模块级 builder 段 S5-decision:374-441 与 goal:88-155、c:125-205、d:154-222 同构 | merge-into:tests/helpers/S5-decision-fixture.ts::openS5DecisionFixture | S5-decision-fixture 的 107 个 importer；把 pausedB、额外 schemas、s5Host 工具差异做成 options 后，其余三份 open 体删除 | 1800 | — | 高 |
| F-02 | handwritten | tests/helpers/S5-decision-fixture.ts:548-568（另见 S5R2-d-support.ts:324-344、S5-goal-settings-support.ts:257-270、S5R2-c-support.ts:294-307） | S5-decision 与 S5R2-d 两份用 encodeGovernance 直接拼 CompletionPolicyRevision、ArchitectureBaselineRevision 与两个 active 指针后 seedCommit（decision:554-568、d:330-344）；S5-goal-settings 与 S5R2-c 两份只手写 policy revision + ProjectCompletionPolicyActive（goal:264-270、c:302-307），紧随其后的 baseline 已走 adopt（goal:271-284、c:308-321）；公开步骤已存在：createArchitectureCatalogService.adoptInitialArchitecture（src/core/work-graph/architecture/catalog-service.ts:454，路由 src/app/core-routes.ts:379）与 completionPolicies.installCompletionPolicy/activateCompletionPolicy（src/core/work-graph/configuration/project-bootstrap-service.ts:700/812；路由 core-routes.ts:374-375）；同仓库 WP2-platform-support.ts:262-281 已用同一组公开步骤产出这四类记录 | convert:createArchitectureCatalogService.adoptInitialArchitecture + projectBootstrapServices.completionPolicies.installCompletionPolicy/activateCompletionPolicy | WP2-platform-support.ts:262-281 的公开写法；四份手写段合计约 75 行 | 75 | — | 高 |
| F-03 | duplicate | tests/helpers/S1-workflow-archive-fixture.ts:264-499（第二份 createTaskClaimFixture）、560-790（第二份 createB2ExecutionFixture） | 不是转出口，是完整第二份实现：与 task-claim-fixture.ts:160-453 逐行匹配 196/236 行；与 B2-execution-fixture.ts:104-314 匹配 206/231 行（difflib），差异只在 clock 参数、audit 包装和 3 个 kernel 字段；S1 版反而已经改用公开 createProjectBootstrapServices（:306-345） | merge-into:tests/helpers/task-claim-fixture.ts::createTaskClaimFixture（把 clock/audit/公开 bootstrap 上移），B2 层保留 tests/helpers/B2-execution-fixture.ts::createB2ExecutionFixture，S1 改为 import | task-claim-fixture.ts 被 58 个文件 import，B2-execution-fixture.ts 被约 20 个文件 import；S1 版仅 3 个测试 | 390 | — | 高 |
| F-04 | duplicate | tests/helpers/A2-restart-fixture.ts:262-324（pausedRunOnClosedHost，63 行） | 与 tests/scenarios/support/common.ts:459-522 的 pausedRunOnClosedHostChecked 逐行同构：同 startAG2bHost 脚本、同 controls/submit 与 goals/control 暂停、同 reconcile HL-01/driveChecked/run 状态/controls read/oldSession.occupancy 断言、同 writeStaleLock；common.ts:454 注释自认是同一 helper。9 个场景测试文件全用 common.ts 的 Checked 版（A7/A8/K-W/K3-29/K3-41 等） | delete:tests/helpers/A2-restart-fixture.ts:262-324 | tests/scenarios/support/common.ts::pausedRunOnClosedHostChecked（已被 A7/A8/K-W 等使用） | 63 | — | 高 |
| F-05 | duplicate | tests/helpers/K3-35-continuation-fixture.ts:924-933（review round 链） | 内联 claimK3ReviewRound(phase:review) → recordK3Conclusion → endK3RunCompleted → settleK3Review，与 K3-proposal-round.ts:807-819 runK3ReviewRound 的实现相同；K3-35 已在 :108-112 从该文件 import 其它函数 | merge-into:tests/helpers/K3-proposal-round.ts::runK3ReviewRound | runK3ReviewRound 返回的 settled 与同一链条断言 | 10 | — | 高 |
| F-06 | duplicate | tests/helpers/B2-401-world.ts:185-198（openK3ReviewCardWorld → openK3BlockedReviewServices → seed → answer → openRealRunHarness） | 同一启动段已被 K3-blocked-command-fixture.ts:536-554 的 openK3BlockedCommandWorld 提取；B2-blocked-runtime.ts:391-398 就是复用它再 answer(skip_as_done)；B2-401 只是多传 realKernelCommandFacts 并保持 sqlite | merge-into:tests/helpers/K3-blocked-command-fixture.ts::openK3BlockedCommandWorld（把 realKernelCommandFacts/sqlite 暴露成 option，B2-401 自行 answer） | B2-blocked-runtime.ts:391-398 的同一路径 | 14 | — | 中 |
| F-07 | duplicate | tests/helpers/S2B-task-timeline-fixture.ts:259-404、425-544（对应 tests/helpers/S2B-track-fixture.ts:243-349、350-471） | 核对结论：不是大段复制。difflib 全文件仅 171/891 行匹配，且没有任何 ≥20 行的连续相同块；同名 setClock/runPin/installStaticCompletionPolicy/claim/enter/end 只是同一套 plumbing 的各自实现，policyId、projectRevision 读法和 requeue 参数不同 | keep-note:不合并（此前疑为约 180 行重复，实测不成立） | — | 0 | — | 高 |
| F-08 | duplicate | tests/helpers/S2A-notices-workspace2-fixture.ts:81-321（openW2World）对 tests/helpers/S2A-notices-support.ts:141-225（openManyTaskWorld） | 核对结论：不是复制。该两段 difflib 只匹配 25 行、全文件 47/322 行，没有 ≥15 行连续相同块；两者复用的是同一批 owner（S5 fixture/claim 栈），但各自维护 scope、治理和 claim 栈 | keep-note:不合并（此前疑为约 200 行重复，实测不成立） | — | 0 | — | 高 |
| F-09 | duplicate | tests/helpers/S5-application-support.ts:40-52；同型代码另见 S5-user-message-support.ts:21-33、S5-queue-support.ts:52-59、W2-whiteboard-fixture.ts、WP1-entry-fixture.ts、WP1-handover-fixture.ts、WP2-duties-fixture.ts 等约 10 个 helper | 每个 helper 都各写一份 committed()/ready() 结果断言包装（3-5 行，抛同一种错误文案）；这是纯断言工具重复，不影响场景构造 | keep-note:建议由 lead 统一收进 tests/helpers/result-assertions.ts；本轮不单方面改 | — | 0 | — | 中 |
| F-10 | handwritten | tests/helpers/task-claim-fixture.ts:199-235（scope + governance seed） | 手工 policyFixture/architectureFixture + encodeGovernance + PreparedCommit + backend.records.commit 落 Project/Workspace/策略/架构；公开步骤已存在：项目 createProject（project-bootstrap-service.ts:528）、registerWorkspace（同文件 :601）、install/activateCompletionPolicy（:700/:812）、adoptInitialArchitecture（catalog-service.ts:454）；同仓库 S1-workflow-archive-fixture.ts:306-345 与 WP2-platform-support.ts:262-281 已按公开步骤写 | convert:createProjectBootstrapServices.projects.createProject/registerWorkspace + completionPolicies.install/activate + createArchitectureCatalogService.adoptInitialArchitecture | 不删；58 个 importer 的 revision/事件序列会随之变化，需单独切片 | 37 | — | 中 |
| F-11 | handwritten | tests/helpers/graph-session-fixture.ts:330-351（project/workspace/policy PreparedCommit） | encodeProjectSnapshot/encodeWorkspaceSnapshot/encodeGraphGovernance 手工拼 scopeSeed 后 backend.records.commit；公开步骤同上（project-bootstrap-service.ts:528/601/700/812） | convert:createProjectBootstrapServices.projects.createProject/registerWorkspace + completionPolicies.install/activate | 不删；转换后事件/修订会变 | 22 | — | 中 |
| F-12 | handwritten | tests/helpers/C1-mailbox-fixture.ts:105-163（RunSnapshot 两次 commitRaw） | 把真实 claim 出的 RunSnapshot 改成 status:running、executionAuthorization.phase:entered、假 kernel run/turn，再以 schemaId RunSnapshot@1 直接 commit；:106 注释自认「does not exercise the Runtime entered producer」。公开步骤存在：RuntimeExecutionPort.startRun（src/core/agent-runtime/ports.ts:49；execution-driver.ts 的 startRun 要求 prepared task execution） | convert:runtime.startRun（先 prepare 出 manifest 再 start，替代两次手写 RunSnapshot commit） | — | 8 | — | 中 |
| F-13 | handwritten | tests/helpers/C2-runtime-platform-fixture.ts:104-113（另见 tests/helpers/K-readonly-work-support.ts:80-87） | 两处都用 commitRaw 手写 CoordinationPolicyRevisionSnapshot@1 与 ProjectCoordinationPolicyActiveSnapshot@1；src 里只有 decoder/reader（role-record-codecs.ts:301/463、role-memory-service.ts:686），没有 install/activate coordination policy 的公开写入步骤 | keep-note:无公开步骤，不转换；两处同构，若以后加写入步骤应只留一份 seed | — | 0 | — | 中 |
| F-14 | handwritten | tests/helpers/executed-files-stub.ts:22-28（createExecutedFilesStub 返回 not_available DTO） | stub 返回 availability:not_available、possiblyIncomplete:true；生产 createGoalExecutedFilesReader 只返回 availability:available（src/core/work-graph/tasks/goal-executed-files-reader.ts:204-206），组合根也只装配真 reader（src/composition/create-platform.ts:961）；grep 未发现测试断言 stub 的 not_available 值，它只是让端口可注入的替身 | convert:createGoalExecutedFilesReader（或删 stub 后 26 处改注入真 reader/available 值） | 真 reader 的 S2B-34-executed-files.test.ts:214/252；需逐处核对没有依赖 not_available 的断言 | 33 | — | 中 |
| F-15 | stale | tests/helpers/S1-session-facts-fixture.ts:204-233（createLegacySession；另见 tests/helpers/S2C-L-line-support.ts:466-476 与 tests/scenarios/S2C-K-legacy-provenance.test.ts:132 的同名 copy） | 把 encodeSessionOperationRecord 的结果再覆盖 json:JSON.stringify(operation)（:221 注释「today encoder must not normalize the old action to new」），写旧 wire 的 SessionOperation；消费的是 legacyProvenance 回填分支（src/core/work-graph/state/session-availability.ts:501）。决定 79-1：发布前只读当前格式，不写迁移、不留旧版解码分支 | keep-note:待生产 legacyProvenance/createLegacySessionProvenanceReader 清理时同批删这 3 份旧记录 seed | 当前 createSession 路径（S1-session-facts-fixture.ts:181）已覆盖新记录；旧路径按 79-1 应不存在 | 40 | — | 中 |
| F-16 | stale | tests/helpers/S5-queue-support.ts:284-298（legacyNoticeWire）、304 与 400（legacyRounds/legacyRequeues 分支） | 注释自认「Legacy wire compatibility only … serialize the selected pre-S5 fields exactly as an old producer did」，实现删掉当前格式的 since/noticeAutomationCap；NR05/NR08 断言 position.kind:legacy、cap:null，只有旧生产者记录才触发。决定 79-1 | keep-note:NR05/NR08 是冻结规格行；先由生产侧清 S2A_ROUND_REVERIFY_LEGACY_LOOKUP 旧索引组（evidence-record-codecs.ts:718-742）再同批删 helper 分支与两行用例 | 当前格式由 S5-notices 的 NR01/NR06/NR07 覆盖 | 35 | 是 | 中 |
| F-17 | stale | tests/helpers/SP-storage-migration-fixture.ts:1-31（addLegacyFtsArtifacts） | 构造 4B-era 的 next_fts_meta 与 next_fts_% 虚表；生产仍保留打开旧库时 drop 遗留 FTS 的旧格式清理（src/core/record-store/sqlite-text-scan.ts:13-14、136-150）。决定 79-1：代码只读当前格式，不写迁移，不留旧版本分支 | keep-note:待生产 legacy drop（sqlite-text-scan.ts:136-150 与 LEGACY_TABLES_SQL:55-60）删除时，同批删本 helper 与 SP-12 段 | 当前格式扫描由 SP-01…SP-11 覆盖；生产旧 drop 另计 | 31 | — | 中 |
| F-18 | stale | tests/helpers/graph-session-fixture.ts:403-417（seedLegacyArchitectureBaseline） | 手工写一个没有 catalog 的 ArchitectureBaselineRevision + active 指针；公开 adopt 的 catalog 是必填（src/contracts/architecture-catalog.ts:48-58），所以这个组合只能手写。生产 catalog-service.ts:415 的 catalog:null 读法就是为这类历史 baseline 保留的 | keep-note:按 79-1 属旧格式候选；与生产的 catalog:null 分支（catalog-service.ts:415-444）同批决定 | adoptInitialArchitecture 当前路径（同文件 fixture.adopt） | 15 | — | 中 |
| F-19 | stale | tests/helpers/K-legacy-reader-support.ts:1-23、138-145 | 核对结论：不是 79-1 的旧数据 reader。kernelStores.legacyEntries 是当前 Host 启动配置：src/app/main.ts:153-157 解析并规范化 databasePath，src/core/agent-runtime/kernel-store-locator.ts:59/91 注册成 kind:legacy 的只读 locator（要求 expectedSessionId）；测试钉的是 KA-12/KE4/L8 的当前 close_open_turn 行为 | keep-note:保留，不要删；只去掉 5 个未用 export（43-47、49） | — | 5 | — | 高 |
| F-20 | tamper | tests/helpers/graph-session-fixture.ts:419-435（seedTamperedArchitectureBaseline） | 手工写 contentDigest 与正文不匹配的 baseline（sha256Hex(「a1-tampered-digest」)），只用来触发读/链接时的 digest 防御检查；平台自己的写入永远按正文算 digest，正常路径产生不了这条记录（AGENTS 规则 4、coordinator-mode「only tampering can make」） | delete:tests/helpers/graph-session-fixture.ts:419-435，并删上面两条用例中的 tampered 断言 | 行为只能由篡改数据库触发，不应测试；A1 其它用例（:171 的 legacy 读法）仍覆盖正常读 | 17 | — | 中 |
| F-21 | helper | tests/helpers/WP2-duties-fixture.ts:33-34、45-49、57-72、74-220 | installWP2Role/openWP2DutiesFixture/WP2DutiesFixture/WP2DutiesAdapterFactory/WP2_ROLE_ID 在 src+tests 其它文件 0 命中；openWP2DutiesFixture 本身 121 行，还用 seedCommit 手写 coordination policy；ready/committed 两个包装只被这段死代码使用 | delete:tests/helpers/WP2-duties-fixture.ts:33-34、45-49、57-72、74-220（保留 wp2LegacyDuty、wp2RoleContent 及其 import） | 无调用方；行为由 S5 决策 fixture 与 WP2-platform-support 的公开路径覆盖 | 170 | — | 高 |
| F-22 | helper | tests/helpers/K3-proposal-round.ts:117、130、154、225、370、466、489、553、609、644、679、689、726、733、783、794、826、845、898、910 | 20 个 export 全只在本文件内部使用：类型用于 :169/:256/:383/:475/:527/:589/:620/:654/:690/:745/:808/:864/:898 的签名，k3TakeTaskId/k3WorkRunContext/proposeK3SaferMethodWithTool/reachK3AwaitingApproval 在 :258/:463/:760 与文档示例 :40/:54 内调用 | delete:去掉 20 处 export 关键字（实现保留） | 同文件内部调用；无外部消费者 | 20 | — | 高 |
| F-23 | helper | tests/helpers/K3-35-continuation-fixture.ts:117-122（re-export 块）、130、157-160、199、212、236 | G/P/W/at/baseBrief/sha/task 从本文件的 re-export 无人 import；其中只有 G 在源头也无人用（F-48），baseBrief/sha/task 仍被测试从 pure fixture 直接 import；SAFER_NOTE/K3_35_TASK_ID/K3_35_ANCHORS 与 4 个 options 类型只在本文件内部使用 | delete:把 :117-122 的 re-export 收敛为 APPROVED_COMMAND、K3_35_REQUIRED_REVIEW_BLOCK_ONE、approvedMethodBlockBytes 三项；其余 7 处去掉 export | 同文件内部使用；pure fixture 直接导出 G/baseBrief/sha/task 给需要的测试 | 14 | — | 高 |
| F-24 | helper | tests/helpers/S1-workflow-archive-fixture.ts:160-161、180、187、501-502、509-518 | B2_AT、CLAIM_FIXTURE_AT、CLAIM_FIXTURE_EXPIRED_DEADLINE、ClaimConnection 在 src+tests 只命中定义（B2_AT 只引用 CLAIM_FIXTURE_AT）；B2Admitted/B2Ports/B2PreparedOptions/B2TerminalObservation/B2_INPUT/ClaimRequestOverrides/FixtureAudit/MaterialSpy/RecordSpy/Records 只在同文件内部用 | delete:删 :160-161、:180-185、:501 的 4 个死声明；其余 10 处去掉 export（createTaskClaimFixture 一项归 F-03） | 同文件内部使用；无外部消费者 | 14 | — | 高 |
| F-25 | helper | tests/helpers/RL-query-fixture.ts:19-33、54 | 14 个常量/类型全部只在本文件 :29/:39-40/:96/:117/:131-138/:143-146/:156-169 内部使用；无外部 import | delete:去掉 14 处 export 关键字 | 同文件内部使用；无外部消费者 | 14 | — | 高 |
| F-26 | helper | tests/helpers/S8A-L8-reminder-world.ts:47-162 | A03_CATALOG、hostFor、writeFilesAt 与 10 个类型（CatalogSpec/StageSpec/ReminderBackend/Fault 类型/ReminderGate/ReminderWorld/Options/ModuleSpec）只在同文件内部使用；无外部 import | delete:去掉 13 处 export 关键字（occurrences 被 S8A-L8-reminders-public.test.ts:24 import，保留） | 同文件内部使用；无外部消费者 | 13 | — | 高 |
| F-27 | helper | tests/helpers/K3-padded-review-record.ts:29-40、58-82 | 12 个 K3_PADDED_* 常量与 k3Padded* 函数只在本文件 :53/:59/:64/:69/:74/:83-86/:99/:109/:112-113 内部使用；该测试只取部分入口 | delete:去掉 12 处 export 关键字（纯 fixture 的极值表整体保留） | 同文件内部使用；规格极值表本身不删 | 12 | — | 高 |
| F-28 | helper | tests/helpers/AG2b-collaboration-fixture.ts:63、65、284、286、302、366、405、441 | 两个 POLICY 常量与 coreUrl/coreGet/asRecord/AG2bSeedWrite/AG2bSession/AG2bQueryRefs 只在本文件 :287/:291/:373/:385/:388/:412/:436/:449 内部使用；其中 coreUrl/coreGet/asRecord 在 tests/app/R6-host.test.ts:146-167 又各写了一份相同的本地实现（该测试没有 import 本文件） | delete:去掉 8 处 export 关键字；若 R6 测试愿意复用，可改为 import 这三个工具并删本地三份 | 同文件内部使用；无外部消费者 | 8 | — | 高 |
| F-29 | helper | tests/helpers/S2C-X-scale-fixture.ts:523 | :523 整行 export type { RunSupport, StoreResult, RecordLookupPort, RecordOrderedLookupPort, RecordCountPort, GoalRef, SessionRef }；源 import 在本文件内部已存在 | delete:删 :523 整行（不要删顶部源 import） | 无外部消费者 | 1 | — | 高 |
| F-30 | helper | tests/helpers/WP1-handover-fixture.ts:113、124、352、437、508、518、529、564 | 8 个类型/函数名在其它 tests 文件 0 命中；createHandoverWorkflow 仍被本文件 factory 调用（只去 export）；5 个 fixture 类型只在同文件用 | delete:去掉 8 处 export 关键字（实现保留） | 同文件内部使用；无外部消费者 | 8 | — | 高 |
| F-31 | helper | tests/helpers/RL-resource-caps-support.ts:33-35、140-142、197、209、236-239 | RL_PROBE_MEMORY_BYTES、RL_PROBE_TASKS_MAX、appendLine、unitLoadState 连本文件也不引用（真死）；RL_SYSTEMD_RUN_DEFAULT/cgroupPathOf/scopeDirOf 只在 :319/:205/:210/:214/:219 内部使用 | delete:删 4 个死声明（约 9 行）；另外 3 处去掉 export | 无外部消费者；真死声明无覆盖问题 | 9 | — | 高 |
| F-32 | helper | tests/helpers/S2C-D-node-support.ts:84-86、561、630-638 | incompleteAnomalies（:630-637）全仓只命中定义；:638 的 export type { TaskClaim, EncodedRecord, StoreCommitReceipt } 无人 import；D_AT/ExecutedFilesFacts/NodeStoreCall 只在本文件内部用 | delete:删 incompleteAnomalies 与 :638 整行；其余 4 处去掉 export | 无外部消费者 | 10 | — | 高 |
| F-33 | helper | tests/helpers/S2C-K-scenario-support.ts:30-36、82、127-129、142、172-174 | LinePageRead、lineWrite、sessionRefOf 全仓只命中定义（真死）；LineDetailRead/LinePageRequest/lineContaining/maintenanceSelect 只在同文件内部用 | delete:删 LinePageRead、lineWrite、sessionRefOf；其余 4 处去掉 export | 无外部消费者 | 8 | — | 高 |
| F-34 | helper | tests/helpers/S5-decision-fixture.ts:168、171-172、199、265、351 | S5AllocationCounts/S5GoalSeed 与四个表常量/sourceOf 只在同文件内部使用（S5 四份 fixture 共享这些 builder，见 F-01） | delete:去掉 7 处 export 关键字 | 同文件内部使用 | 7 | — | 高 |
| F-35 | helper | tests/helpers/WP1-scenario-fixture.ts:76-131 | 7 个类型 alias 只在同文件与 WP1 场景内部使用，其它 tests 0 命中 | delete:去掉 7 处 export 关键字 | 同文件内部使用 | 7 | — | 高 |
| F-36 | helper | tests/helpers/WP1-entry-fixture.ts:92、141、146-148、326 | t1 常量与 5 个类型只在同文件内部使用 | delete:去掉 6 处 export 关键字 | 同文件内部使用 | 6 | — | 高 |
| F-37 | helper | tests/helpers/WP2-platform-support.ts:52-53、57、183、866、871 | :52 是 export { B2_AT as WP2_AT } 的别名转出口；WP2_ALL_TOOL_NAMES/WP2PlatformOptions/WP2ObservedCommit/goalSettingsWith/wp2ChecksConfiguration 只在同文件内部使用 | delete:删 :52 整行；其余 5 处去掉 export | 同文件内部使用 | 6 | — | 高 |
| F-38 | helper | tests/helpers/orchestration-fixture.ts:31、43、76、91、146 | isYielded（:146-148）全仓只命中定义（死函数）；ControlledExecutor/RecordingSink/ScriptedModel/ScriptedReply 只在本文件内部使用 | delete:删 isYielded 3 行；其余 4 处去掉 export | 无外部消费者 | 7 | — | 高 |
| F-39 | helper | tests/helpers/B2-crr-world.ts:34、70、85、231-239 | BlockedCallSpec/BlockedRecordOptions/BlockedRecordOutcome 只在同文件内部用；runSnapshotOf（:231-239）全仓只命中定义，注释说给 K3-UR7-crr-failed-set 的兼容出口，但该测试已不引用 | delete:删 runSnapshotOf 9 行；其余 3 处去掉 export | 无外部消费者 | 12 | — | 高 |
| F-40 | helper | tests/helpers/B2-execution-fixture.ts:46、53、55、62 | B2_INPUT/B2Ports/B2TerminalObservation/B2PreparedOptions 只在同文件内部使用；其中 B2TerminalObservation 在 S1 的第二份实现里也被重复声明（见 F-03） | delete:去掉 4 处 export 关键字 | 同文件内部使用 | 4 | — | 高 |
| F-41 | helper | tests/helpers/S2A-notices-support.ts:40-41 | :40 的 OPERATOR/WORKSPACE/noticeWork 无人从本文件 import；:41 export type S5NoticeWork 全仓只命中定义 | delete:从 :40 移除 OPERATOR/WORKSPACE/noticeWork；删 :41 | 无外部消费者 | 2 | — | 高 |
| F-42 | helper | tests/helpers/S2B-be2-reconcile-support.ts:68、188-191 | 4 个类型只在同文件内部使用，其它 tests 0 命中 | delete:去掉 4 处 export 关键字 | 同文件内部使用 | 4 | — | 高 |
| F-43 | helper | tests/helpers/S4B-text-search-support.ts:24、94、104、183 | at/event/change 三个局部构造器与 SearchRequest 类型只在同文件内部使用 | delete:去掉 4 处 export 关键字 | 同文件内部使用 | 4 | — | 高 |
| F-44 | helper | tests/helpers/S8D-platform-fixture.ts:46、53、79、81 | LightScan/FixtureGit/CaptureOutcome/FixtureCapture 只在同文件内部使用 | delete:去掉 4 处 export 关键字 | 同文件内部使用 | 4 | — | 高 |
| F-45 | helper | tests/helpers/W2-whiteboard-fixture.ts:63、66、73、77 | W2Records/agentActorIdFor/W2AgentProposeRequest/W2AgentApplyRequest 只在同文件内部使用 | delete:去掉 4 处 export 关键字 | 同文件内部使用 | 4 | — | 高 |
| F-46 | helper | tests/helpers/WP1-units-fixture.ts:83、336、342、487 | DutyMaintenanceFixture/AssemblerFactsOptions/AssemblerFactsFixture/StartRefusalFixture 只在同文件内部使用 | delete:去掉 4 处 export 关键字 | 同文件内部使用 | 4 | — | 高 |
| F-47 | helper | tests/helpers/graph-session-fixture.ts:61、65、83、89 | GRAPH_FIXTURE_AT/GraphFixtureKind/GraphAcceptedTask/GraphSessionConnection 只在同文件内部使用 | delete:去掉 4 处 export 关键字 | 同文件内部使用 | 4 | — | 高 |
| F-48 | helper | tests/helpers/K3-continuation-pure-fixture.ts:23、33、136-146 | G（:23）唯一外部引用是 K3-35-continuation-fixture:121 的无人 import 转出口，连该转出口一起死；REQUIRED_REVIEW_BLOCK（:136-146，11 行字面量）唯一外部引用是 K3-35-required-review-block.ts:10 的转出口，也无测试 import；task 只在同文件 :34/:71/:87 内部使用 | delete:删 G 与 REQUIRED_REVIEW_BLOCK 字面量；task 去掉 export（另见 F-49 删转出口） | 渲染器用 requiredReviewBlock() 与 K3_35_REQUIRED_REVIEW_BLOCK_ONE，不用这个字面量 | 13 | — | 高 |
| F-49 | helper | tests/helpers/K3-35-required-review-block.ts:1-11（整文件） | 文件只是 export { REQUIRED_REVIEW_BLOCK, requiredReviewBlock } from ./K3-continuation-pure-fixture.js；文件头自认 keeps the existing import path（F-014 重构留下的兼容转出口）；纯 fixture 已直接导出 requiredReviewBlock（:149） | merge-into:tests/helpers/K3-continuation-pure-fixture.ts::requiredReviewBlock（两个测试改 import 后删本文件） | pure fixture 的同名函数完全覆盖 | 11 | — | 高 |
| F-50 | helper | tests/helpers/*.ts — 48 个文件、88 个 export，逐文件单点（明细见证据列） | A2-restart-fixture:3、B2-401-world:3、C2-runtime-platform:2、K-readonly-host:1、K-readonly-work:1、K-session:2、K-t1:1、K3-07:3、K3-35-prepare:3、K3-35-runtime:3、K3-blocked-command:2、K3-mailbox-seam:1、K3-mixed-seams:1、K3-real-workspace:3、K3-tool-seams:1、RL-kernel-sandbox-double:3、S1-archive-service:3、S1-public-anchor:1、S1-runtime-scenario:2、S1-session-facts:1、S2A-notices-overbound:1、S2A-notices-workspace2:3、S2B-activity:1、S2B-be1r-kernel-faults:2、S2B-r2-activity:2、S2B-r2-backfill-kernel:1、S2B-r2-calendar-reverify:1、S2B-runtime-store:3、S2B-task-timeline:2、S2B-track:1、S2C-K2:1、S2C-L-check:1、S2C-L-line:1、S2C-P-pins:3、S4A-note-fault:2、S4A-note:1、S4A-note-interleave:1、S4A-note-scope:2、S4B-note-check:1、S4B-note-multi-scope:3、S4C2-note-card:2、S5-application:1、S5-queue:1、S5R2-a:2、S8A-L8-prepare:1、task-claim:3、change-stream-reader:2（K3-continuation-pure 与 K3-35-required-review-block 已单列为 F-48、F-49） | delete:逐文件去掉 export 关键字；其中 K3-35-prepare:134 与 S2C-K2:32-34 等完全未用的声明直接删 | 全部只在本文件内部使用或完全未用；无测试消费者 | 88 | — | 中 |

## JSON

```json
[
 {
  "id": "F-01",
  "category": "duplicate",
  "file": "tests/helpers/S5R2-c-support.ts",
  "lines": "1-1081（另见 tests/helpers/S5-goal-settings-support.ts:1-791、tests/helpers/S5R2-d-support.ts:1-952）",
  "tests": "S5-decision-fixture.ts 被 107 个文件 import（81 个测试 + 26 个 helper，rev 统计）；S5R2-c、S5R2-d、S5-goal-settings 各只有 2 个 importer",
  "evidence": "difflib 逐行匹配：S5R2-c 与 S5-decision 相同 719/1082 行，S5R2-d 794/953，S5-goal-settings 721/792；三份文件头自认 copy（S5R2-c:1-9、S5R2-d:1-4、S5-goal-settings:1-2）；seedCommit 在 S5-decision:517-537、goal:226-246、c:263-283、d:293-313 四份逐行相同（21 行）；模块级 builder 段 S5-decision:374-441 与 goal:88-155、c:125-205、d:154-222 同构",
  "action": "merge-into:tests/helpers/S5-decision-fixture.ts::openS5DecisionFixture",
  "covered_by": "S5-decision-fixture 的 107 个 importer；把 pausedB、额外 schemas、s5Host 工具差异做成 options 后，其余三份 open 体删除",
  "est_lines": 1800,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-02",
  "category": "handwritten",
  "file": "tests/helpers/S5-decision-fixture.ts",
  "lines": "548-568（另见 S5R2-d-support.ts:324-344、S5-goal-settings-support.ts:257-270、S5R2-c-support.ts:294-307）",
  "tests": "S5 决策/设置/队列各测试经这些 fixture 建世界",
  "evidence": "S5-decision 与 S5R2-d 两份用 encodeGovernance 直接拼 CompletionPolicyRevision、ArchitectureBaselineRevision 与两个 active 指针后 seedCommit（decision:554-568、d:330-344）；S5-goal-settings 与 S5R2-c 两份只手写 policy revision + ProjectCompletionPolicyActive（goal:264-270、c:302-307），紧随其后的 baseline 已走 adopt（goal:271-284、c:308-321）；公开步骤已存在：createArchitectureCatalogService.adoptInitialArchitecture（src/core/work-graph/architecture/catalog-service.ts:454，路由 src/app/core-routes.ts:379）与 completionPolicies.installCompletionPolicy/activateCompletionPolicy（src/core/work-graph/configuration/project-bootstrap-service.ts:700/812；路由 core-routes.ts:374-375）；同仓库 WP2-platform-support.ts:262-281 已用同一组公开步骤产出这四类记录",
  "action": "convert:createArchitectureCatalogService.adoptInitialArchitecture + projectBootstrapServices.completionPolicies.installCompletionPolicy/activateCompletionPolicy",
  "covered_by": "WP2-platform-support.ts:262-281 的公开写法；四份手写段合计约 75 行",
  "est_lines": 75,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-03",
  "category": "duplicate",
  "file": "tests/helpers/S1-workflow-archive-fixture.ts",
  "lines": "264-499（第二份 createTaskClaimFixture）、560-790（第二份 createB2ExecutionFixture）",
  "tests": "仅 tests/business/S1-archive-flow.test.ts:73、tests/business/S1-session-maintenance.test.ts:51 和 tests/business/K3-review-workflow-rows.test.ts 从本文件取 createB2ExecutionFixture",
  "evidence": "不是转出口，是完整第二份实现：与 task-claim-fixture.ts:160-453 逐行匹配 196/236 行；与 B2-execution-fixture.ts:104-314 匹配 206/231 行（difflib），差异只在 clock 参数、audit 包装和 3 个 kernel 字段；S1 版反而已经改用公开 createProjectBootstrapServices（:306-345）",
  "action": "merge-into:tests/helpers/task-claim-fixture.ts::createTaskClaimFixture（把 clock/audit/公开 bootstrap 上移），B2 层保留 tests/helpers/B2-execution-fixture.ts::createB2ExecutionFixture，S1 改为 import",
  "covered_by": "task-claim-fixture.ts 被 58 个文件 import，B2-execution-fixture.ts 被约 20 个文件 import；S1 版仅 3 个测试",
  "est_lines": 390,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-04",
  "category": "duplicate",
  "file": "tests/helpers/A2-restart-fixture.ts",
  "lines": "262-324（pausedRunOnClosedHost，63 行）",
  "tests": "外部 0 个 import（grep -rnw pausedRunOnClosedHost tests 只命中定义与本文件）",
  "evidence": "与 tests/scenarios/support/common.ts:459-522 的 pausedRunOnClosedHostChecked 逐行同构：同 startAG2bHost 脚本、同 controls/submit 与 goals/control 暂停、同 reconcile HL-01/driveChecked/run 状态/controls read/oldSession.occupancy 断言、同 writeStaleLock；common.ts:454 注释自认是同一 helper。9 个场景测试文件全用 common.ts 的 Checked 版（A7/A8/K-W/K3-29/K3-41 等）",
  "action": "delete:tests/helpers/A2-restart-fixture.ts:262-324",
  "covered_by": "tests/scenarios/support/common.ts::pausedRunOnClosedHostChecked（已被 A7/A8/K-W 等使用）",
  "est_lines": 63,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-05",
  "category": "duplicate",
  "file": "tests/helpers/K3-35-continuation-fixture.ts",
  "lines": "924-933（review round 链）",
  "tests": "K3-35 场景本身",
  "evidence": "内联 claimK3ReviewRound(phase:review) → recordK3Conclusion → endK3RunCompleted → settleK3Review，与 K3-proposal-round.ts:807-819 runK3ReviewRound 的实现相同；K3-35 已在 :108-112 从该文件 import 其它函数",
  "action": "merge-into:tests/helpers/K3-proposal-round.ts::runK3ReviewRound",
  "covered_by": "runK3ReviewRound 返回的 settled 与同一链条断言",
  "est_lines": 10,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-06",
  "category": "duplicate",
  "file": "tests/helpers/B2-401-world.ts",
  "lines": "185-198（openK3ReviewCardWorld → openK3BlockedReviewServices → seed → answer → openRealRunHarness）",
  "tests": "tests/runtime/B2-401-world.test.ts",
  "evidence": "同一启动段已被 K3-blocked-command-fixture.ts:536-554 的 openK3BlockedCommandWorld 提取；B2-blocked-runtime.ts:391-398 就是复用它再 answer(skip_as_done)；B2-401 只是多传 realKernelCommandFacts 并保持 sqlite",
  "action": "merge-into:tests/helpers/K3-blocked-command-fixture.ts::openK3BlockedCommandWorld（把 realKernelCommandFacts/sqlite 暴露成 option，B2-401 自行 answer）",
  "covered_by": "B2-blocked-runtime.ts:391-398 的同一路径",
  "est_lines": 14,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "F-07",
  "category": "duplicate",
  "file": "tests/helpers/S2B-task-timeline-fixture.ts",
  "lines": "259-404、425-544（对应 tests/helpers/S2B-track-fixture.ts:243-349、350-471）",
  "tests": "S2B 时间线与 track 两组测试",
  "evidence": "核对结论：不是大段复制。difflib 全文件仅 171/891 行匹配，且没有任何 ≥20 行的连续相同块；同名 setClock/runPin/installStaticCompletionPolicy/claim/enter/end 只是同一套 plumbing 的各自实现，policyId、projectRevision 读法和 requeue 参数不同",
  "action": "keep-note:不合并（此前疑为约 180 行重复，实测不成立）",
  "covered_by": "—",
  "est_lines": 0,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-08",
  "category": "duplicate",
  "file": "tests/helpers/S2A-notices-workspace2-fixture.ts",
  "lines": "81-321（openW2World）对 tests/helpers/S2A-notices-support.ts:141-225（openManyTaskWorld）",
  "tests": "S2A notices 两组测试",
  "evidence": "核对结论：不是复制。该两段 difflib 只匹配 25 行、全文件 47/322 行，没有 ≥15 行连续相同块；两者复用的是同一批 owner（S5 fixture/claim 栈），但各自维护 scope、治理和 claim 栈",
  "action": "keep-note:不合并（此前疑为约 200 行重复，实测不成立）",
  "covered_by": "—",
  "est_lines": 0,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-09",
  "category": "duplicate",
  "file": "tests/helpers/S5-application-support.ts",
  "lines": "40-52；同型代码另见 S5-user-message-support.ts:21-33、S5-queue-support.ts:52-59、W2-whiteboard-fixture.ts、WP1-entry-fixture.ts、WP1-handover-fixture.ts、WP2-duties-fixture.ts 等约 10 个 helper",
  "tests": "各 helper 的调用方",
  "evidence": "每个 helper 都各写一份 committed()/ready() 结果断言包装（3-5 行，抛同一种错误文案）；这是纯断言工具重复，不影响场景构造",
  "action": "keep-note:建议由 lead 统一收进 tests/helpers/result-assertions.ts；本轮不单方面改",
  "covered_by": "—",
  "est_lines": 0,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "F-10",
  "category": "handwritten",
  "file": "tests/helpers/task-claim-fixture.ts",
  "lines": "199-235（scope + governance seed）",
  "tests": "58 个文件 import createTaskClaimFixture；B2/S2B/S5/WP2 都建在这份 fixture 上",
  "evidence": "手工 policyFixture/architectureFixture + encodeGovernance + PreparedCommit + backend.records.commit 落 Project/Workspace/策略/架构；公开步骤已存在：项目 createProject（project-bootstrap-service.ts:528）、registerWorkspace（同文件 :601）、install/activateCompletionPolicy（:700/:812）、adoptInitialArchitecture（catalog-service.ts:454）；同仓库 S1-workflow-archive-fixture.ts:306-345 与 WP2-platform-support.ts:262-281 已按公开步骤写",
  "action": "convert:createProjectBootstrapServices.projects.createProject/registerWorkspace + completionPolicies.install/activate + createArchitectureCatalogService.adoptInitialArchitecture",
  "covered_by": "不删；58 个 importer 的 revision/事件序列会随之变化，需单独切片",
  "est_lines": 37,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "F-11",
  "category": "handwritten",
  "file": "tests/helpers/graph-session-fixture.ts",
  "lines": "330-351（project/workspace/policy PreparedCommit）",
  "tests": "A1 架构目录、Session 生命周期等测试经该 fixture",
  "evidence": "encodeProjectSnapshot/encodeWorkspaceSnapshot/encodeGraphGovernance 手工拼 scopeSeed 后 backend.records.commit；公开步骤同上（project-bootstrap-service.ts:528/601/700/812）",
  "action": "convert:createProjectBootstrapServices.projects.createProject/registerWorkspace + completionPolicies.install/activate",
  "covered_by": "不删；转换后事件/修订会变",
  "est_lines": 22,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "F-12",
  "category": "handwritten",
  "file": "tests/helpers/C1-mailbox-fixture.ts",
  "lines": "105-163（RunSnapshot 两次 commitRaw）",
  "tests": "C1 mailbox 测试",
  "evidence": "把真实 claim 出的 RunSnapshot 改成 status:running、executionAuthorization.phase:entered、假 kernel run/turn，再以 schemaId RunSnapshot@1 直接 commit；:106 注释自认「does not exercise the Runtime entered producer」。公开步骤存在：RuntimeExecutionPort.startRun（src/core/agent-runtime/ports.ts:49；execution-driver.ts 的 startRun 要求 prepared task execution）",
  "action": "convert:runtime.startRun（先 prepare 出 manifest 再 start，替代两次手写 RunSnapshot commit）",
  "covered_by": "—",
  "est_lines": 8,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "F-13",
  "category": "handwritten",
  "file": "tests/helpers/C2-runtime-platform-fixture.ts",
  "lines": "104-113（另见 tests/helpers/K-readonly-work-support.ts:80-87）",
  "tests": "C2 平台测试、K readonly 测试",
  "evidence": "两处都用 commitRaw 手写 CoordinationPolicyRevisionSnapshot@1 与 ProjectCoordinationPolicyActiveSnapshot@1；src 里只有 decoder/reader（role-record-codecs.ts:301/463、role-memory-service.ts:686），没有 install/activate coordination policy 的公开写入步骤",
  "action": "keep-note:无公开步骤，不转换；两处同构，若以后加写入步骤应只留一份 seed",
  "covered_by": "—",
  "est_lines": 0,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "F-14",
  "category": "handwritten",
  "file": "tests/helpers/executed-files-stub.ts",
  "lines": "22-28（createExecutedFilesStub 返回 not_available DTO）",
  "tests": "13 个文件、26 处调用（5 个 helper 传递注入 + 8 个测试直接用；grep createExecutedFilesStub）",
  "evidence": "stub 返回 availability:not_available、possiblyIncomplete:true；生产 createGoalExecutedFilesReader 只返回 availability:available（src/core/work-graph/tasks/goal-executed-files-reader.ts:204-206），组合根也只装配真 reader（src/composition/create-platform.ts:961）；grep 未发现测试断言 stub 的 not_available 值，它只是让端口可注入的替身",
  "action": "convert:createGoalExecutedFilesReader（或删 stub 后 26 处改注入真 reader/available 值）",
  "covered_by": "真 reader 的 S2B-34-executed-files.test.ts:214/252；需逐处核对没有依赖 not_available 的断言",
  "est_lines": 33,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "F-15",
  "category": "stale",
  "file": "tests/helpers/S1-session-facts-fixture.ts",
  "lines": "204-233（createLegacySession；另见 tests/helpers/S2C-L-line-support.ts:466-476 与 tests/scenarios/S2C-K-legacy-provenance.test.ts:132 的同名 copy）",
  "tests": "tests/work-graph/S1-dispatch-guards.test.ts:153、tests/work-graph/S1-provenance.test.ts:214、tests/work-graph/S2C-lines-page.test.ts:397",
  "evidence": "把 encodeSessionOperationRecord 的结果再覆盖 json:JSON.stringify(operation)（:221 注释「today encoder must not normalize the old action to new」），写旧 wire 的 SessionOperation；消费的是 legacyProvenance 回填分支（src/core/work-graph/state/session-availability.ts:501）。决定 79-1：发布前只读当前格式，不写迁移、不留旧版解码分支",
  "action": "keep-note:待生产 legacyProvenance/createLegacySessionProvenanceReader 清理时同批删这 3 份旧记录 seed",
  "covered_by": "当前 createSession 路径（S1-session-facts-fixture.ts:181）已覆盖新记录；旧路径按 79-1 应不存在",
  "est_lines": 40,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "F-16",
  "category": "stale",
  "file": "tests/helpers/S5-queue-support.ts",
  "lines": "284-298（legacyNoticeWire）、304 与 400（legacyRounds/legacyRequeues 分支）",
  "tests": "tests/work-graph/S5-notices.test.ts:195（NR05）、:271-272（NR08）",
  "evidence": "注释自认「Legacy wire compatibility only … serialize the selected pre-S5 fields exactly as an old producer did」，实现删掉当前格式的 since/noticeAutomationCap；NR05/NR08 断言 position.kind:legacy、cap:null，只有旧生产者记录才触发。决定 79-1",
  "action": "keep-note:NR05/NR08 是冻结规格行；先由生产侧清 S2A_ROUND_REVERIFY_LEGACY_LOOKUP 旧索引组（evidence-record-codecs.ts:718-742）再同批删 helper 分支与两行用例",
  "covered_by": "当前格式由 S5-notices 的 NR01/NR06/NR07 覆盖",
  "est_lines": 35,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "F-17",
  "category": "stale",
  "file": "tests/helpers/SP-storage-migration-fixture.ts",
  "lines": "1-31（addLegacyFtsArtifacts）",
  "tests": "tests/record-store/SP-text-scan.test.ts:415（SP-12 段）",
  "evidence": "构造 4B-era 的 next_fts_meta 与 next_fts_% 虚表；生产仍保留打开旧库时 drop 遗留 FTS 的旧格式清理（src/core/record-store/sqlite-text-scan.ts:13-14、136-150）。决定 79-1：代码只读当前格式，不写迁移，不留旧版本分支",
  "action": "keep-note:待生产 legacy drop（sqlite-text-scan.ts:136-150 与 LEGACY_TABLES_SQL:55-60）删除时，同批删本 helper 与 SP-12 段",
  "covered_by": "当前格式扫描由 SP-01…SP-11 覆盖；生产旧 drop 另计",
  "est_lines": 31,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "F-18",
  "category": "stale",
  "file": "tests/helpers/graph-session-fixture.ts",
  "lines": "403-417（seedLegacyArchitectureBaseline）",
  "tests": "tests/work-graph/A1-architecture-catalog.test.ts:171、tests/work-graph/A1-independent-review.test.ts:66",
  "evidence": "手工写一个没有 catalog 的 ArchitectureBaselineRevision + active 指针；公开 adopt 的 catalog 是必填（src/contracts/architecture-catalog.ts:48-58），所以这个组合只能手写。生产 catalog-service.ts:415 的 catalog:null 读法就是为这类历史 baseline 保留的",
  "action": "keep-note:按 79-1 属旧格式候选；与生产的 catalog:null 分支（catalog-service.ts:415-444）同批决定",
  "covered_by": "adoptInitialArchitecture 当前路径（同文件 fixture.adopt）",
  "est_lines": 15,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "F-19",
  "category": "stale",
  "file": "tests/helpers/K-legacy-reader-support.ts",
  "lines": "1-23、138-145",
  "tests": "tests/scenarios/K-W-workflow-close.test.ts:489-535",
  "evidence": "核对结论：不是 79-1 的旧数据 reader。kernelStores.legacyEntries 是当前 Host 启动配置：src/app/main.ts:153-157 解析并规范化 databasePath，src/core/agent-runtime/kernel-store-locator.ts:59/91 注册成 kind:legacy 的只读 locator（要求 expectedSessionId）；测试钉的是 KA-12/KE4/L8 的当前 close_open_turn 行为",
  "action": "keep-note:保留，不要删；只去掉 5 个未用 export（43-47、49）",
  "covered_by": "—",
  "est_lines": 5,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-20",
  "category": "tamper",
  "file": "tests/helpers/graph-session-fixture.ts",
  "lines": "419-435（seedTamperedArchitectureBaseline）",
  "tests": "tests/work-graph/A1-architecture-catalog.test.ts:184、tests/work-graph/A1-session-lifecycle.test.ts:114",
  "evidence": "手工写 contentDigest 与正文不匹配的 baseline（sha256Hex(「a1-tampered-digest」)），只用来触发读/链接时的 digest 防御检查；平台自己的写入永远按正文算 digest，正常路径产生不了这条记录（AGENTS 规则 4、coordinator-mode「only tampering can make」）",
  "action": "delete:tests/helpers/graph-session-fixture.ts:419-435，并删上面两条用例中的 tampered 断言",
  "covered_by": "行为只能由篡改数据库触发，不应测试；A1 其它用例（:171 的 legacy 读法）仍覆盖正常读",
  "est_lines": 17,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "F-21",
  "category": "helper",
  "file": "tests/helpers/WP2-duties-fixture.ts",
  "lines": "33-34、45-49、57-72、74-220",
  "tests": "唯一 importer tests/work-graph/WP2-message-duties.test.ts:26 只 import wp2LegacyDuty、wp2RoleContent",
  "evidence": "installWP2Role/openWP2DutiesFixture/WP2DutiesFixture/WP2DutiesAdapterFactory/WP2_ROLE_ID 在 src+tests 其它文件 0 命中；openWP2DutiesFixture 本身 121 行，还用 seedCommit 手写 coordination policy；ready/committed 两个包装只被这段死代码使用",
  "action": "delete:tests/helpers/WP2-duties-fixture.ts:33-34、45-49、57-72、74-220（保留 wp2LegacyDuty、wp2RoleContent 及其 import）",
  "covered_by": "无调用方；行为由 S5 决策 fixture 与 WP2-platform-support 的公开路径覆盖",
  "est_lines": 170,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-22",
  "category": "helper",
  "file": "tests/helpers/K3-proposal-round.ts",
  "lines": "117、130、154、225、370、466、489、553、609、644、679、689、726、733、783、794、826、845、898、910",
  "tests": "无测试 import 这些名字（逐名 grep -rnw tests）",
  "evidence": "20 个 export 全只在本文件内部使用：类型用于 :169/:256/:383/:475/:527/:589/:620/:654/:690/:745/:808/:864/:898 的签名，k3TakeTaskId/k3WorkRunContext/proposeK3SaferMethodWithTool/reachK3AwaitingApproval 在 :258/:463/:760 与文档示例 :40/:54 内调用",
  "action": "delete:去掉 20 处 export 关键字（实现保留）",
  "covered_by": "同文件内部调用；无外部消费者",
  "est_lines": 20,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-23",
  "category": "helper",
  "file": "tests/helpers/K3-35-continuation-fixture.ts",
  "lines": "117-122（re-export 块）、130、157-160、199、212、236",
  "tests": "取本文件的测试只 import openRealRunHarness、APPROVED_COMMAND、K3_35_REQUIRED_REVIEW_BLOCK_ONE、approvedMethodBlockBytes、WORST_REASON 及类型（grep）",
  "evidence": "G/P/W/at/baseBrief/sha/task 从本文件的 re-export 无人 import；其中只有 G 在源头也无人用（F-48），baseBrief/sha/task 仍被测试从 pure fixture 直接 import；SAFER_NOTE/K3_35_TASK_ID/K3_35_ANCHORS 与 4 个 options 类型只在本文件内部使用",
  "action": "delete:把 :117-122 的 re-export 收敛为 APPROVED_COMMAND、K3_35_REQUIRED_REVIEW_BLOCK_ONE、approvedMethodBlockBytes 三项；其余 7 处去掉 export",
  "covered_by": "同文件内部使用；pure fixture 直接导出 G/baseBrief/sha/task 给需要的测试",
  "est_lines": 14,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-24",
  "category": "helper",
  "file": "tests/helpers/S1-workflow-archive-fixture.ts",
  "lines": "160-161、180、187、501-502、509-518",
  "tests": "无测试 import 这些名字；本文件 3 个 importer 只用 beginConsultation/completeWork/retireSession 等与 createB2ExecutionFixture",
  "evidence": "B2_AT、CLAIM_FIXTURE_AT、CLAIM_FIXTURE_EXPIRED_DEADLINE、ClaimConnection 在 src+tests 只命中定义（B2_AT 只引用 CLAIM_FIXTURE_AT）；B2Admitted/B2Ports/B2PreparedOptions/B2TerminalObservation/B2_INPUT/ClaimRequestOverrides/FixtureAudit/MaterialSpy/RecordSpy/Records 只在同文件内部用",
  "action": "delete:删 :160-161、:180-185、:501 的 4 个死声明；其余 10 处去掉 export（createTaskClaimFixture 一项归 F-03）",
  "covered_by": "同文件内部使用；无外部消费者",
  "est_lines": 14,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-25",
  "category": "helper",
  "file": "tests/helpers/RL-query-fixture.ts",
  "lines": "19-33、54",
  "tests": "3 个测试只 import createRLQueryFixture、rlQueryHostCtx、RLQueryFixture",
  "evidence": "14 个常量/类型全部只在本文件 :29/:39-40/:96/:117/:131-138/:143-146/:156-169 内部使用；无外部 import",
  "action": "delete:去掉 14 处 export 关键字",
  "covered_by": "同文件内部使用；无外部消费者",
  "est_lines": 14,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-26",
  "category": "helper",
  "file": "tests/helpers/S8A-L8-reminder-world.ts",
  "lines": "47-162",
  "tests": "两个 S8A 测试只 import A03_STAGES、FIRST_AT、THREE_HOURS_FIVE、createReminderWorld、architectureRows、waitObservationState",
  "evidence": "A03_CATALOG、hostFor、writeFilesAt 与 10 个类型（CatalogSpec/StageSpec/ReminderBackend/Fault 类型/ReminderGate/ReminderWorld/Options/ModuleSpec）只在同文件内部使用；无外部 import",
  "action": "delete:去掉 13 处 export 关键字（occurrences 被 S8A-L8-reminders-public.test.ts:24 import，保留）",
  "covered_by": "同文件内部使用；无外部消费者",
  "est_lines": 13,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-27",
  "category": "helper",
  "file": "tests/helpers/K3-padded-review-record.ts",
  "lines": "29-40、58-82",
  "tests": "唯一 importer tests/runtime/K3-48-3-extremes-pure.test.ts",
  "evidence": "12 个 K3_PADDED_* 常量与 k3Padded* 函数只在本文件 :53/:59/:64/:69/:74/:83-86/:99/:109/:112-113 内部使用；该测试只取部分入口",
  "action": "delete:去掉 12 处 export 关键字（纯 fixture 的极值表整体保留）",
  "covered_by": "同文件内部使用；规格极值表本身不删",
  "est_lines": 12,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-28",
  "category": "helper",
  "file": "tests/helpers/AG2b-collaboration-fixture.ts",
  "lines": "63、65、284、286、302、366、405、441",
  "tests": "AG2b 系测试不 import 这些名字（逐名 grep）",
  "evidence": "两个 POLICY 常量与 coreUrl/coreGet/asRecord/AG2bSeedWrite/AG2bSession/AG2bQueryRefs 只在本文件 :287/:291/:373/:385/:388/:412/:436/:449 内部使用；其中 coreUrl/coreGet/asRecord 在 tests/app/R6-host.test.ts:146-167 又各写了一份相同的本地实现（该测试没有 import 本文件）",
  "action": "delete:去掉 8 处 export 关键字；若 R6 测试愿意复用，可改为 import 这三个工具并删本地三份",
  "covered_by": "同文件内部使用；无外部消费者",
  "est_lines": 8,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-29",
  "category": "helper",
  "file": "tests/helpers/S2C-X-scale-fixture.ts",
  "lines": "523",
  "tests": "无测试从本文件 import 这 8 个名字",
  "evidence": ":523 整行 export type { RunSupport, StoreResult, RecordLookupPort, RecordOrderedLookupPort, RecordCountPort, GoalRef, SessionRef }；源 import 在本文件内部已存在",
  "action": "delete:删 :523 整行（不要删顶部源 import）",
  "covered_by": "无外部消费者",
  "est_lines": 1,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-30",
  "category": "helper",
  "file": "tests/helpers/WP1-handover-fixture.ts",
  "lines": "113、124、352、437、508、518、529、564",
  "tests": "唯一 importer tests/business/WP1-continuation-handover.test.ts 只取具体 factory 与 HandoverComposition",
  "evidence": "8 个类型/函数名在其它 tests 文件 0 命中；createHandoverWorkflow 仍被本文件 factory 调用（只去 export）；5 个 fixture 类型只在同文件用",
  "action": "delete:去掉 8 处 export 关键字（实现保留）",
  "covered_by": "同文件内部使用；无外部消费者",
  "est_lines": 8,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-31",
  "category": "helper",
  "file": "tests/helpers/RL-resource-caps-support.ts",
  "lines": "33-35、140-142、197、209、236-239",
  "tests": "RL 资源上限测试不 import 这些名字",
  "evidence": "RL_PROBE_MEMORY_BYTES、RL_PROBE_TASKS_MAX、appendLine、unitLoadState 连本文件也不引用（真死）；RL_SYSTEMD_RUN_DEFAULT/cgroupPathOf/scopeDirOf 只在 :319/:205/:210/:214/:219 内部使用",
  "action": "delete:删 4 个死声明（约 9 行）；另外 3 处去掉 export",
  "covered_by": "无外部消费者；真死声明无覆盖问题",
  "est_lines": 9,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-32",
  "category": "helper",
  "file": "tests/helpers/S2C-D-node-support.ts",
  "lines": "84-86、561、630-638",
  "tests": "节点详情测试不 import 这些名字",
  "evidence": "incompleteAnomalies（:630-637）全仓只命中定义；:638 的 export type { TaskClaim, EncodedRecord, StoreCommitReceipt } 无人 import；D_AT/ExecutedFilesFacts/NodeStoreCall 只在本文件内部用",
  "action": "delete:删 incompleteAnomalies 与 :638 整行；其余 4 处去掉 export",
  "covered_by": "无外部消费者",
  "est_lines": 10,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-33",
  "category": "helper",
  "file": "tests/helpers/S2C-K-scenario-support.ts",
  "lines": "30-36、82、127-129、142、172-174",
  "tests": "2C-K 场景测试不 import 这些名字",
  "evidence": "LinePageRead、lineWrite、sessionRefOf 全仓只命中定义（真死）；LineDetailRead/LinePageRequest/lineContaining/maintenanceSelect 只在同文件内部用",
  "action": "delete:删 LinePageRead、lineWrite、sessionRefOf；其余 4 处去掉 export",
  "covered_by": "无外部消费者",
  "est_lines": 8,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-34",
  "category": "helper",
  "file": "tests/helpers/S5-decision-fixture.ts",
  "lines": "168、171-172、199、265、351",
  "tests": "S5 系测试不 import 这 7 个名字",
  "evidence": "S5AllocationCounts/S5GoalSeed 与四个表常量/sourceOf 只在同文件内部使用（S5 四份 fixture 共享这些 builder，见 F-01）",
  "action": "delete:去掉 7 处 export 关键字",
  "covered_by": "同文件内部使用",
  "est_lines": 7,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-35",
  "category": "helper",
  "file": "tests/helpers/WP1-scenario-fixture.ts",
  "lines": "76-131",
  "tests": "唯一 importer tests/scenarios/WP1-wiring.test.ts 只取具体 open/drive 入口",
  "evidence": "7 个类型 alias 只在同文件与 WP1 场景内部使用，其它 tests 0 命中",
  "action": "delete:去掉 7 处 export 关键字",
  "covered_by": "同文件内部使用",
  "est_lines": 7,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-36",
  "category": "helper",
  "file": "tests/helpers/WP1-entry-fixture.ts",
  "lines": "92、141、146-148、326",
  "tests": "两个 importer 只 import open*Fixture、t0、AnomalyReaderFixture",
  "evidence": "t1 常量与 5 个类型只在同文件内部使用",
  "action": "delete:去掉 6 处 export 关键字",
  "covered_by": "同文件内部使用",
  "est_lines": 6,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-37",
  "category": "helper",
  "file": "tests/helpers/WP2-platform-support.ts",
  "lines": "52-53、57、183、866、871",
  "tests": "4 个 importer 只取 createWP2Platform、WP2PlatformFixture、requestText、observeStage 等",
  "evidence": ":52 是 export { B2_AT as WP2_AT } 的别名转出口；WP2_ALL_TOOL_NAMES/WP2PlatformOptions/WP2ObservedCommit/goalSettingsWith/wp2ChecksConfiguration 只在同文件内部使用",
  "action": "delete:删 :52 整行；其余 5 处去掉 export",
  "covered_by": "同文件内部使用",
  "est_lines": 6,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-38",
  "category": "helper",
  "file": "tests/helpers/orchestration-fixture.ts",
  "lines": "31、43、76、91、146",
  "tests": "编排测试只 import createScriptedExecutor 等入口",
  "evidence": "isYielded（:146-148）全仓只命中定义（死函数）；ControlledExecutor/RecordingSink/ScriptedModel/ScriptedReply 只在本文件内部使用",
  "action": "delete:删 isYielded 3 行；其余 4 处去掉 export",
  "covered_by": "无外部消费者",
  "est_lines": 7,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-39",
  "category": "helper",
  "file": "tests/helpers/B2-crr-world.ts",
  "lines": "34、70、85、231-239",
  "tests": "B2/K3 CRR 测试不 import 这些名字",
  "evidence": "BlockedCallSpec/BlockedRecordOptions/BlockedRecordOutcome 只在同文件内部用；runSnapshotOf（:231-239）全仓只命中定义，注释说给 K3-UR7-crr-failed-set 的兼容出口，但该测试已不引用",
  "action": "delete:删 runSnapshotOf 9 行；其余 3 处去掉 export",
  "covered_by": "无外部消费者",
  "est_lines": 12,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-40",
  "category": "helper",
  "file": "tests/helpers/B2-execution-fixture.ts",
  "lines": "46、53、55、62",
  "tests": "B2 系测试只 import createB2ExecutionFixture 与 B2ExecutionFixture 等",
  "evidence": "B2_INPUT/B2Ports/B2TerminalObservation/B2PreparedOptions 只在同文件内部使用；其中 B2TerminalObservation 在 S1 的第二份实现里也被重复声明（见 F-03）",
  "action": "delete:去掉 4 处 export 关键字",
  "covered_by": "同文件内部使用",
  "est_lines": 4,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-41",
  "category": "helper",
  "file": "tests/helpers/S2A-notices-support.ts",
  "lines": "40-41",
  "tests": "S2A notices 测试只从 :40 取 WORKSPACE_SCOPE/committed/pin/ready",
  "evidence": ":40 的 OPERATOR/WORKSPACE/noticeWork 无人从本文件 import；:41 export type S5NoticeWork 全仓只命中定义",
  "action": "delete:从 :40 移除 OPERATOR/WORKSPACE/noticeWork；删 :41",
  "covered_by": "无外部消费者",
  "est_lines": 2,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-42",
  "category": "helper",
  "file": "tests/helpers/S2B-be2-reconcile-support.ts",
  "lines": "68、188-191",
  "tests": "S2B 回填测试只 import withTool/prepare 等入口",
  "evidence": "4 个类型只在同文件内部使用，其它 tests 0 命中",
  "action": "delete:去掉 4 处 export 关键字",
  "covered_by": "同文件内部使用",
  "est_lines": 4,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-43",
  "category": "helper",
  "file": "tests/helpers/S4B-text-search-support.ts",
  "lines": "24、94、104、183",
  "tests": "SP/S4B 文本检索测试只 import keyOf/open/seed/search 等入口",
  "evidence": "at/event/change 三个局部构造器与 SearchRequest 类型只在同文件内部使用",
  "action": "delete:去掉 4 处 export 关键字",
  "covered_by": "同文件内部使用",
  "est_lines": 4,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-44",
  "category": "helper",
  "file": "tests/helpers/S8D-platform-fixture.ts",
  "lines": "46、53、79、81",
  "tests": "S8D 测试只 import createS8DPlatform 等入口",
  "evidence": "LightScan/FixtureGit/CaptureOutcome/FixtureCapture 只在同文件内部使用",
  "action": "delete:去掉 4 处 export 关键字",
  "covered_by": "同文件内部使用",
  "est_lines": 4,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-45",
  "category": "helper",
  "file": "tests/helpers/W2-whiteboard-fixture.ts",
  "lines": "63、66、73、77",
  "tests": "3 个 importer 只取 createW2WhiteboardFixture/W2WhiteboardFixture/W2PlanDraftV2 等",
  "evidence": "W2Records/agentActorIdFor/W2AgentProposeRequest/W2AgentApplyRequest 只在同文件内部使用",
  "action": "delete:去掉 4 处 export 关键字",
  "covered_by": "同文件内部使用",
  "est_lines": 4,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-46",
  "category": "helper",
  "file": "tests/helpers/WP1-units-fixture.ts",
  "lines": "83、336、342、487",
  "tests": "WP1 units 测试只取具体 fixture 函数",
  "evidence": "DutyMaintenanceFixture/AssemblerFactsOptions/AssemblerFactsFixture/StartRefusalFixture 只在同文件内部使用",
  "action": "delete:去掉 4 处 export 关键字",
  "covered_by": "同文件内部使用",
  "est_lines": 4,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-47",
  "category": "helper",
  "file": "tests/helpers/graph-session-fixture.ts",
  "lines": "61、65、83、89",
  "tests": "A1 测试只取 openGraphSessionFixture 等入口",
  "evidence": "GRAPH_FIXTURE_AT/GraphFixtureKind/GraphAcceptedTask/GraphSessionConnection 只在同文件内部使用",
  "action": "delete:去掉 4 处 export 关键字",
  "covered_by": "同文件内部使用",
  "est_lines": 4,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-48",
  "category": "helper",
  "file": "tests/helpers/K3-continuation-pure-fixture.ts",
  "lines": "23、33、136-146",
  "tests": "4 个测试只 import baseBrief、sha、APPROVED_COMMAND",
  "evidence": "G（:23）唯一外部引用是 K3-35-continuation-fixture:121 的无人 import 转出口，连该转出口一起死；REQUIRED_REVIEW_BLOCK（:136-146，11 行字面量）唯一外部引用是 K3-35-required-review-block.ts:10 的转出口，也无测试 import；task 只在同文件 :34/:71/:87 内部使用",
  "action": "delete:删 G 与 REQUIRED_REVIEW_BLOCK 字面量；task 去掉 export（另见 F-49 删转出口）",
  "covered_by": "渲染器用 requiredReviewBlock() 与 K3_35_REQUIRED_REVIEW_BLOCK_ONE，不用这个字面量",
  "est_lines": 13,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-49",
  "category": "helper",
  "file": "tests/helpers/K3-35-required-review-block.ts",
  "lines": "1-11（整文件）",
  "tests": "tests/runtime/K3-35-approved-methods-brief.test.ts:23、tests/runtime/K3-35-T-by-hand.test.ts:53（只取 requiredReviewBlock）",
  "evidence": "文件只是 export { REQUIRED_REVIEW_BLOCK, requiredReviewBlock } from ./K3-continuation-pure-fixture.js；文件头自认 keeps the existing import path（F-014 重构留下的兼容转出口）；纯 fixture 已直接导出 requiredReviewBlock（:149）",
  "action": "merge-into:tests/helpers/K3-continuation-pure-fixture.ts::requiredReviewBlock（两个测试改 import 后删本文件）",
  "covered_by": "pure fixture 的同名函数完全覆盖",
  "est_lines": 11,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "F-50",
  "category": "helper",
  "file": "tests/helpers/*.ts",
  "lines": "48 个文件、88 个 export，逐文件单点（明细见证据列）",
  "tests": "逐名 grep -rnw tests：无测试 import",
  "evidence": "A2-restart-fixture:3、B2-401-world:3、C2-runtime-platform:2、K-readonly-host:1、K-readonly-work:1、K-session:2、K-t1:1、K3-07:3、K3-35-prepare:3、K3-35-runtime:3、K3-blocked-command:2、K3-mailbox-seam:1、K3-mixed-seams:1、K3-real-workspace:3、K3-tool-seams:1、RL-kernel-sandbox-double:3、S1-archive-service:3、S1-public-anchor:1、S1-runtime-scenario:2、S1-session-facts:1、S2A-notices-overbound:1、S2A-notices-workspace2:3、S2B-activity:1、S2B-be1r-kernel-faults:2、S2B-r2-activity:2、S2B-r2-backfill-kernel:1、S2B-r2-calendar-reverify:1、S2B-runtime-store:3、S2B-task-timeline:2、S2B-track:1、S2C-K2:1、S2C-L-check:1、S2C-L-line:1、S2C-P-pins:3、S4A-note-fault:2、S4A-note:1、S4A-note-interleave:1、S4A-note-scope:2、S4B-note-check:1、S4B-note-multi-scope:3、S4C2-note-card:2、S5-application:1、S5-queue:1、S5R2-a:2、S8A-L8-prepare:1、task-claim:3、change-stream-reader:2（K3-continuation-pure 与 K3-35-required-review-block 已单列为 F-48、F-49）",
  "action": "delete:逐文件去掉 export 关键字；其中 K3-35-prepare:134 与 S2C-K2:32-34 等完全未用的声明直接删",
  "covered_by": "全部只在本文件内部使用或完全未用；无测试消费者",
  "est_lines": 88,
  "spec_row": false,
  "confidence": "中"
 }
]
```

## 分类合计

| 类别 | 条数 | 估计行数（删除/改动） |
|---|---|---|
| stale | 5 | 126 |
| duplicate | 8 | 2277 |
| trivial | 0 | 0 |
| handwritten | 6 | 175 |
| tamper | 1 | 17 |
| helper | 30 | 488 |
| **合计** | **50** | **3083** |

说明：行数含“去 export 关键字”的逐行改动；S5 四份 fixture 的 1,800 行是合并后预计删除的重复体上限，实际值取决于 options 化后保留多少独有分支。

## 覆盖说明

**整读（协调者）**：`K-legacy-reader-support.ts`、`K3-35-required-review-block.ts`、`SP-storage-migration-fixture.ts`、`executed-files-stub.ts`、`change-stream-reader.ts`、`S2A-route-storage-support.ts`、`S2C-K2-scenario-support.ts`、`S2B-counting-off-support.ts`；另核读 `A2-restart-fixture.ts:250-324`、`S5-decision-fixture.ts:500-570`、`S5-goal-settings-support.ts:255-285`、`S1-workflow-archive-fixture.ts:300-345/560-790`、`graph-session-fixture.ts:325-355/403-435`、`C1-mailbox-fixture.ts:95-170`、`WP2-duties-fixture.ts:30-220`、`S2B-task-timeline-fixture.ts:259-300`、`S2B-track-fixture.ts:243-280`、`S2A-notices-workspace2-fixture.ts:81-200`、`S2A-notices-support.ts:141-225`、`docs/refactor/HANDOFF.md:563-604`。

**part1（37 文件）**：5 个短文件整读，其余 32 个按 export/引用/commit 三类 grep + 20-40 行上下文核对；UNREAD 0。
**part2（30 文件）**：10 个文件的相关段落精读，20 个按 export/import/相似度 grep 核对；UNREAD 0。
**part3（43 文件）**：4 个短文件整读，39 个按 export/commit/encode 结构 grep + 20-120 行上下文核对；7 个未逐行，其中 2 个由协调者补读，剩 5 个见下。

**没有读完的 5 个文件**（均未发现 duplicate/handwritten 信号，只按 grep 处理了 export）：`S2A-planning-fixture.ts`（120 行）、`S2B-activity-fixture.ts`（590 行，只核了 dead export）、`S2B-be1r2-support.ts`（117 行）、`S2B-r3-r4-support.ts`（46 行）、`S2B-runtime-tools-support.ts`（95 行）。part3 原列的 `S2A-route-storage-support.ts` 与 `S2B-counting-off-support.ts` 已由协调者整读，不再算未读。

**抽样复核（协调者亲自核过，不是转述）**：F-01（difflib 比例与三份文件头自认 copy）、F-02（S5:548-568 与 WP2-platform-support:262-281 的公开写法）、F-03（S1 两份 copy 的 difflib 196/236 与 206/231）、F-04（common.ts:459-522 与 A2:262-324 同构、0 外部 import）、F-10（task-claim:199-235 与 S1:306-345）、F-12（C1:105-163 自认手写）、F-15（S1:221 的旧 wire 覆盖）、F-16（S5-queue:284-298 注释与 NR05/NR08）、F-20（graph-session:419-435 的 digest 不匹配）、F-21（WP2-duties 只 import 两个函数）、F-33（S2C-K 的 3 个真死声明）、F-38（isYielded 只命中定义）、F-39（runSnapshotOf 只命中定义）、F-40 至 F-47 的 grep 结果、F-07/F-08（两个“疑似重复”实测不成立）、F-19（legacyEntries 是当前配置）。

**未决**：
- S5 合并后到底删多少行（1,800 是上限；pausedB、额外 schemas、s5Host 工具三处差异需要做成 options，实际保留量待切片估）。
- F-10/F-11 的转换会改 58 个 importer 看到的 revision/事件序列，必须单独立切片，不能和纯 export 清理同批。
- F-14 的 26 个注入点里是否有个别断言依赖 `not_available`：grep 未发现，但需逐处确认后才能删 stub。
- F-15/F-16/F-17/F-18 是生产侧（79-1）先清还是测试侧先清，需 lead 定顺序；本报告只给 keep-note。

