# T 轮测试盘点：E1 区（tests/app 与 composition）

只读盘点，未改动仓库；报告基于 `./.dsh-ref/t-common.md`、`./.dsh-ref/coordinator-mode.md`、`docs/refactor/HANDOFF.md` 决定 79（尤其 79-1、79-4）与 85-4、根 `AGENTS.md` 第 3、4、9 条。

**范围。** `.dsh-ref/t-area-E1.txt` 的 78 个文件、22,612 行（tests/app 76 个，tests/composition 2 个）。三个子 agent 分区全读（27 + 26 + 25 个文件），各自把发现写入 `.dsh-scratch/E1-part{1,2,3}.md`；主控合并、去重并逐条回到源行复核（见文末“核对与覆盖”）。

**编号。** 合并后统一为 E1-01…E1-32；括号内保留原分区编号，便于回溯子报告。

**结果概览。** 32 条：过时 3、重复 9、琐碎 5、手写事实 8、只为篡改 0、辅助 7；估计改动/删除 1,104 行。其中 `keep-note` 5 条不立即改测试，`delete` 5 条、`merge-into` 13 条、`convert` 9 条（按行动计）。


## 1. 发现表

| 编号 | 类别 | 位置（path:line；test 名） | 证据 | 建议 | 被谁覆盖 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---|---|---|
| E1-01（P1-01） | 过时 | `tests/app/MVP-ui-entry.test.ts`<br>261-273<br>keeps display ids per scope and migrates only the explicit v1 scopeKey（v1 迁移子块） | 测试用 `DISPLAY_PREFERENCE_V1_KEY` 造 v1 记录并断言迁移到 scopeA、readGlobal 也迁移（MVP-ui-entry:261-273）。生产侧 src/ui/state/display-preference.ts:16 标为 Legacy single-record key，:108 读旧键，:119-134 是 v1 迁移分支。决定 79-1（docs/refactor/HANDOFF.md:565-570）要求只读当前格式、不写迁移、不留旧版本解码分支，并点名写进配置的旧格式按本条重看；产品从未真实运行。 | delete | 行为已不存在：发布前无旧数据（决定 79-1；清理时同删 src/ui/state/display-preference.ts:16,108,119-134 的 v1 迁移） | 14 | — | 高 |
| E1-02（P1-02） | 过时 | `tests/app/S0-attention-edge-label.test.ts`<br>41-96<br>S0-01 writes the requirement kind and label into the depends edge, not [object Object]；S0-02…；S0-03… | scan() 只给 plans.queryTaskGraph（S0:52-53），是 slice 0 的旧 seam。src/app/attention-observer.ts:651-655 在 readAttentionGraph 存在时明确不再走 plans/catalog 旧读法；真实 Host 总会注入该读法（src/app/host.ts:1444-1446），组合根总会提供包装（src/composition/create-platform.ts:1509-1515）。当前入口的同一 depends:kind:label 断言在 tests/app/S3-attention-context.test.ts:300-333（AT04，readAttentionGraph seam）。 | convert:createAttentionScanner 的 readAttentionGraph seam（同 tests/app/S3-attention-context.test.ts:300-333） | tests/app/S3-attention-context.test.ts:300-333（AT04，其他片） | 15 | S0-01..03 | 高 |
| E1-03（P2-13） | 过时 | `tests/app/S2B-backfill-workflow.test.ts, tests/app/S2B-backfill-host.test.ts`<br>S2B-backfill-workflow:122-125,236,355; S2B-backfill-host:71-74<br>2B-16 automatic backfill covers only [now-14d, now)…；2B-18…；2B-42 an old Run… | 这些 Run 都结束在“开始记录”之前：workflow:113 注释写明“Four executions ended 2, 13, 15 and 30 days before the recording epoch”，:126 才 ensureRecording；host:71-74 也先造结束 Run 再启动写 epoch 的 Host（:91-97）。2B 以后任何 Run 都由持租约的 Host 创建，Host 启动第一件事是写 ActivityRecording（S2B-activity-fixture.ts:551-557），新库不可能出现“结束早于 epoch”的 Run。79-1（HANDOFF:565-570）下这是只在开发库存在的旧数据态；行为本身（补算无记录 Run）仍由 2B-19/2B-41 覆盖。 | keep-note | 行为仍在：tests/app/S2B-backfill-workflow.test.ts:290-330（2B-19）、tests/app/S2B-41-decision54-backfill-bound.test.ts:128-287（2B-41） | 0 | 2B-16/18/42 | 中 |
| E1-04（P1-03） | 重复 | `tests/app/K-R-runtime-capabilities.test.ts`<br>76-113<br>KA-17 reports that a Work line continues in the same Session… | K-R 头自述“It is the group R copy of the KA-17 assertions and never edits the frozen file”（K-R:9-11）。两边都经真实 Host POST runtime/capabilities：kernelSessionApiVersion===3（A2:164 对 K-R:112）、same-Session-after-close 与 new-Session-when-not-possible（A2:125-126 对 K-R:90-101）重复；K-R 多 L8 fallback 逐句。K-R 是 KA-17 行钉子，保留；若要合并，只删 A2:164,125-126 这组重复断言（约 8 行），A2 的 5.2/5.4 独有句保留。 | keep-note | tests/app/A2-runtime-capabilities.test.ts:144-233（另一份；A2 保留 5.2/5.4 独有断言） | 0 | KA-17 | 中 |
| E1-05（P1-04） | 重复 | `tests/app/R6-workbench.test.ts`<br>302-368（历史子块）<br>projects real original history in order and keeps task hierarchy separate from execution dependencies and real work links | 同一 renderSessionHistoryTimeline。R6 重复 session-rendering 的断言：用户/助手正文与原始顺序（R6:353-355,366 对 session-rendering:395-405）、raw disclosure 默认收起（R6:357-360 对 :428-430）、未知记录保留（R6:362 对 :432-433）、cursor/position 保留（R6:363-365 对 :434-435）。session-rendering 是更完整的渲染契约；R6 该 test 后半段任务层级/依赖、work link、execution entry（:370-479）无别处覆盖，须保留。 | merge-into:tests/app/session-rendering.test.ts::keeps every original record reachable in raw form and in original order | tests/app/session-rendering.test.ts:395-440（其他片） | 40 | — | 中 |
| E1-06（P2-01） | 重复 | `tests/app/S2B-backfill-host.test.ts`<br>68-137<br>2B-16 the leased Host records the epoch before reconcile and auto-backfills only the last 14 days | 同一 2B-16 行三份：本文件 68-137、tests/app/S2B-r2-backfill-real-kernel.test.ts:96-134、tests/app/S2B-backfill-workflow.test.ts:118-181。real-kernel 已覆盖 Host 写 epoch、只补 14 天、区间外 not_backfilled（:103-130）；workflow 覆盖重启不再写（:172-180）。本文件独有 recordingSince 字面值（:92-97）、空 Kernel→显式 unknown（:113-115）、第二次 Host 启动不再写（:121-136），故三份不能直接互删；若合并，先搬走这三条。 | keep-note | 三份互相覆盖：tests/app/S2B-r2-backfill-real-kernel.test.ts:96-134、tests/app/S2B-backfill-workflow.test.ts:118-181 | 0 | 2B-16 | 中 |
| E1-07（P2-04） | 重复 | `tests/app/S2B-r2-backfill-revision-race.test.ts`<br>55-88<br>R13 a write that lands after selection makes the backfill report skipped/record_changed | 与 tests/runtime/S2B-44-backfill-late-evidence-race.test.ts:87-215（规格行 2B-44，其他片）同一场景同一断言：补算按选中 revision 写时被更晚的写抢先→skipped/record_changed（本文件 :83 对 S2B-44:154）。2B-44 用真 RUN-21 与在 RecordStore 边界停住提交（:127-170），更接近真实路径；本文件 :90-109 的 unchanged 用例无别处覆盖，保留。 | merge-into:tests/runtime/S2B-44-backfill-late-evidence-race.test.ts::2B-44 | tests/runtime/S2B-44-backfill-late-evidence-race.test.ts:87-215（其他片，规格行 2B-44） | 34 | — | 中 |
| E1-08（P2-05） | 重复 | `tests/app/S2B-35-activity-routes.test.ts`<br>256-276<br>2B-35 (c) activity/backfill is forbidden for members and platform automation | 同一准入 isHumanHost（src/business/workflow/activity-backfill.ts:249-252）在两处用同一组 forbidden 验证：本文件成员 query_run + system 自动化；tests/app/S2B-backfill-workflow.test.ts:332-350（2B-20）work_run 成员 + 同一 system 自动化（:333-349）。路由层无自己的检查，src/app/core-routes.ts:1157 只把 ctx 与 input 原样转给 bindings.backfillActivityRange，所以 (c) 只是多一层转发的第二次调用。 | keep-note | tests/app/S2B-backfill-workflow.test.ts:332-350（2B-20） | 0 | 2B-35(c)/2B-20 | 中 |
| E1-09（P3-01） | 重复 | `tests/app/S8A-L8-capture-start.test.ts`<br>215-231,255-269<br>a rejected start state read goes to the failure exit with its code and reason；a start state read that throws maps to unavailable while the signal is not aborted | 两处注入 start observation-state 读失败（:218-220 返回 rejected/forbidden，:258 抛错），断言同一 failure exit：requestSeq 1、status failed、pending true 与 code/reason（:225-229、:263-267）。tests/work-graph/S8A-L8-observation-state.test.ts:671-693（L8-7）与 :695-715（L8-8）覆盖同一场景，并用 start revision 保护与旧观测保留断言（:687-692、:708-713）；capture-start 独有的是 forbidden code 透传，可作为 L8-7 的变体并入。 | merge-into:tests/work-graph/S8A-L8-observation-state.test.ts::L8-7/L8-8 | tests/work-graph/S8A-L8-observation-state.test.ts:671-715（其他片，L8-7/L8-8） | 24 | — | 中 |
| E1-10（P3-02） | 重复 | `tests/app/S8A-L8-capture-start.test.ts`<br>310-361<br>L8 capture start cancellation [memory/sqlite]: writes nothing when the start state read is cancelled while it rejects/throws/ready | cancellationCase（:311-357）在 close 时让 held start read 分别失败/抛错/返回 ready，断言 requestSeq 1、status requested、pending true、current null、counts.failure=0/capture=0/state=1（:347-354）。同一三例由 tests/work-graph/S8A-L8-observation-state.test.ts:717-743（L8-9）、:745-769（L8-10）、:771-796（L8-11）覆盖，且 L8-9/10/11 另断言旧观测保留（:741、:767、:793）。capture-start 的调用计数可并入。 | merge-into:tests/work-graph/S8A-L8-observation-state.test.ts::L8-9/L8-10/L8-11 | tests/work-graph/S8A-L8-observation-state.test.ts:717-796（其他片，L8-9/10/11） | 52 | — | 高 |
| E1-11（P3-06） | 重复 | `tests/app/S8A-architecture-routes.test.ts`<br>111-176<br>A-02b: one successful compare-formal request returns the two exact findings | 与 tests/composition/S8A-AE1-formal-comparison.test.ts:165-189 的 A-02b 同一 fixture（src/a/one.ts 与 src/b/lib.ts，同一 A→B catalog）和逐字相同的两条 findings：route 侧 :167-172 对 AE1:182-185（cycle detail 'src/a/one.ts ⇄ src/b/lib.ts'；import_undeclared detail 'src/a/one.ts'）。route 测试独有的是 HTTP architecture/compare-formal 路径（:156-166），AE1 独有的是 memory/sqlite 两后端。 | merge-into:tests/composition/S8A-AE1-formal-comparison.test.ts::AE1 A-02b public cycle comparison | tests/composition/S8A-AE1-formal-comparison.test.ts:165-189（其他片，A-02b） | 15 | A-02b | 中 |
| E1-12（P3-09） | 重复 | `tests/app/change-feed.test.ts`<br>57-123<br>Last-Event-ID resume decision（4 tests） | 与 tests/app/change-stream.test.ts:145-181 断言同一组 resume 决策：最新 cursor ready（feed:72-76 对 stream:158）、窗口内 gap 合并成一条 change（feed:77-84 对 stream:159-162）、cursor_too_old（feed:89-90,102 对 stream:165-166）、cursor_unknown（feed:91-92 对 stream:167-168）、cursor_invalid（feed:93-96 对 stream:169-170）。feed 独有的是空账本/head_unknown（:107-123）与多事件 commit 内部 cursor 的精确断言（:81-84）；ring eviction 两边都有（feed:99-105 对 stream:164-166），合并时保留 stream 侧即可。若按 unit/integration 分层保留，降为 keep-note。 | merge-into:tests/app/change-stream.test.ts::change stream Last-Event-ID resume | tests/app/change-stream.test.ts:145-181 | 35 | — | 中 |
| E1-13（P1-05） | 琐碎 | `tests/app/orchestration-mechanism.test.ts`<br>28-34<br>produces no delivery and no model work when nothing changed | 三条断言 observe(snapshot,0)===null、observe(snapshot,10_000)===null、observer.processed===null，与 tests/app/S3-attention-context.test.ts:238-248（AT01）相同；AT01 另断言 Host send 计数为 0（:238-248）。该纯 observer 无变化用例不增加覆盖。 | delete | tests/app/S3-attention-context.test.ts:238-248（AT01，其他片） | 7 | — | 高 |
| E1-14（P2-10） | 琐碎 | `tests/app/S4C-record-note-host.test.ts`<br>42-47<br>RW-1 a write-enabled workspace grants record_note with the mailbox tools | 三条断言中的 record_note 由同一文件真 Host 用例在 :169-170 断言（started.scripted.requests[0].tools 含 record_note，而该 binding 的 grant 正是 :89 的 localWorkbenchGrant）；write/send_session_message 与 record_note 同属 :41 的同一 tools 列表，但业务测试只直接断言 record_note，故这一条按 keep-note 处理、不直接删。:49-54 的“无写前缀不授予”是真 Host 用例造不出的反例，保留。 | keep-note | tests/app/S4C-record-note-host.test.ts:169-170（真 Host 请求 tools） | 0 | — | 中 |
| E1-15（P2-11） | 琐碎 | `tests/app/S4C2-scribe-reminders.test.ts`<br>719-730<br>S4C2 real recipient resolver: two scribes, the smallest session id wins | 断言两个 scribe 取较小 session id；同一文件 D-03 已用真 Host + 字面 session id 断言提醒只发给较小的：D03_LOWEST_SESSION（:465）、sent[0].requestId === D03_LOWEST_REQUEST_ID（:485）、inboxOfRef(lowest) 1 条 / remaining 0 条（:488-489）。resolver 规则一改 D-03 即失败，该单测无额外分支。 | delete | tests/app/S4C2-scribe-reminders.test.ts:471-509（D-03） | 12 | — | 中 |
| E1-16（P2-12） | 琐碎 | `tests/app/S2C-line-routes.test.ts`<br>166-170<br>2C-31 (d) lines/list returns exactly the LE3 WorkLineReadPort value | 只有一句 expect(await routeList(...)).toEqual(direct)；(h) 在同一 composed bindings 上对 D1 数据集再断言一次 routeList === directList（:301-302），且还覆盖 archived/read/page。只为 (d) 存在的小 fixture 在 :154-159，但 (e) 的失败注入仍用它（:172-181），故只删 (d) 的 test，不删 fixture。 | merge-into:tests/app/S2C-line-routes.test.ts::2C-31 (h) | tests/app/S2C-line-routes.test.ts:299-302（2C-31 (h)） | 6 | 2C-31(d)/(h) | 高 |
| E1-17（P3-10） | 琐碎 | `tests/app/S8A-L8-http-watermark.test.ts`<br>60-82<br>the same capture body without requestSeq still commits a real observation | 与 tests/app/S8A-L8-auto-capture-host.test.ts:168-186 的 “the manual architecture/capture route still works” 同一业务场景、同一断言：projects/create + workspaces/register 后手动 POST architecture/capture（{workspace, mappings: [], previous: null}），断言 committed、current.captureId 改变、requestSeq 不变、pending false（watermark:71-80 对 host:175-183）；watermark 侧 :69 另断言 baselineSeq===1。该文件保留 reject 行即可。 | merge-into:tests/app/S8A-L8-auto-capture-host.test.ts::the manual architecture/capture route still works | tests/app/S8A-L8-auto-capture-host.test.ts:168-186 | 23 | — | 高 |
| E1-18（P1-06） | 手写事实 | `tests/app/A2-startup-redrive-select.test.ts`<br>34-130<br>§12.1 step 6b (a): only a required active Task with a pending verdict selects its Goal；…an unreadable Task graph is a problem… | 测试用 goalOf（:34-38）手搓 GoalSnapshot，用 graphOf（:49-55）造带 failure.automation.verdict 的 TaskRow（:52-53），经假 plans.queryTaskGraph / listGoals 返回（:64-85），文件头自述“over controlled doubles of the reconcile seam”（:3-5）。coordinator-mode 禁止“builds a state object and hands it to a reader or a stand-in”（.dsh-ref/coordinator-mode.md:45-51）。真实入口已存在：tests/scenarios/A8-host-restart.test.ts:420-457 用真实 Host 启动核对验证同一启动重驱（W-11）；转换保留判定矩阵断言。 | convert:Host 启动 + scripted model + 真实 FAIL/requeue/reverify 步骤（tests/scenarios/A8-host-restart.test.ts:420-457 的 openHostScenario 模式） | tests/scenarios/A8-host-restart.test.ts:420-457（入口已存在） | 55 | — | 高 |
| E1-19（P2-02） | 手写事实 | `tests/app/S2B-backfill-workflow.test.ts`<br>67-89,236,355<br>2B-18 backfill writes unknown…；2B-42 an old Run with no locator and no authorization… | commitLegacyRun 手拼 RunSnapshot（status ended、startedAt null、无授权、无 position record）后 commitRaw 直写（:83-86）。公开步骤存在：同一夹具 claimThenCancel（tests/helpers/S2B-activity-fixture.ts:528-541）用真实 claimTask + runControl 取消，注释写明 RUN-09 未进入；规格 2B-42 原文要求“领取以后、授权以前就取消”（slice-2B-SPEC.md:793）。claim+cancel 后 startedAt 仍空、无授权，endedAt<since 时 provenNotEnteredKernel 为 false（src/contracts/run-activity.ts:91-107），期望值不变。 | convert:claimThenCancel（tests/helpers/S2B-activity-fixture.ts:529，今天存在） | 转换后同一断言不变 | 25 | 2B-18/2B-42 | 高 |
| E1-20（P2-03） | 手写事实 | `tests/app/S2B-r2-backfill-done-cursor.test.ts`<br>44-65,81,84-88<br>R9 the batch-full probe keeps a non-null continuation instead of declaring done | 同一份 commitLegacyRun 直写 RunSnapshot（:59-62），101 条 counted 用 seedLegacyActivity（tests/helpers/S2B-activity-fixture.ts:302-324，内部 commitRaw 写 RunSnapshot）。真实路径存在：runAndEnd（:515-520，真实 claim/enter/end）+ 公开 writeActivity（:543-549）；但夹具计划只有 12 个 work task（:72-73），今天造不出 103 个真实 Run，需把 adoptInitialPlan 的任务表扩到 ≥103（:355-388 已是公开 Plan 路径）。101 次真实 Run 有耗时风险。 | convert:真实 runAndEnd ×103 + 公开 writeActivity（夹具计划需扩到 ≥103 任务） | 同一文件 R9 断言不变 | 31 | — | 中 |
| E1-21（P2-06） | 手写事实 | `tests/app/S2B-41-decision54-backfill-bound.test.ts`<br>218-223<br>2B-41 (BE3): the automatic backfill bounds A by its own closed Turn, excludes B, and is not capacity | 测试用 fx.deps.kernelStores.withStore + vendor closeOpenTurn 直接关 A 的 Turn（:218-223），绕过 K 片 A 的公开操作。公开步骤存在：RuntimeExecutionPort.closeOpenTurn（src/core/agent-runtime/runtime.ts:135-144，先复核 Run/授权/Session 事实再调同一 Kernel seam），Workflow 的 close_open_turn 步（src/business/workflow/workflow.ts:1311）就调它；规格 2B-41 原文指的是这条 Runtime 操作（slice-2B-SPEC.md:792）。转换可能需 RUN-24 requeue 证明（runtime.ts:159-183），未实跑验证。 | convert:RuntimeExecutionPort.closeOpenTurn（今天存在；可能需补 RUN-24 requeue 事实） | 转换后 countedThroughTurnEnd:true 断言不变 | 6 | 2B-41 | 中 |
| E1-22（P2-07） | 手写事实 | `tests/app/S2B-backfill-workflow.test.ts`<br>325-329<br>2B-19 a Run that ended after recording began but has no tally… | f.writeActivity(failed, unknownFacts('history_read_failed', …)) 直接写结束时的 unknown 事实；该事实本应由结束那次 Kernel 重读失败产生（规格 2B-08 行，真路径 tests/composition/S2B-be1-counting-failure.test.ts:78）。这里只测“补算把它换成 recorded_late”。公开步骤存在，但 S2BActivityFixture.end()（tests/helpers/S2B-activity-fixture.ts:488-513）没有 Kernel 重读失败接缝，需补一个 fault 包装；故把握低。 | convert:ExecutionEntryPort.recordRunResult + 一次 Kernel 历史读失败（2B-08 路径；夹具需补接缝） | tests/composition/S2B-be1-counting-failure.test.ts:78（其他片，生产路径） | 2 | 2B-19 | 低 |
| E1-23（P3-03） | 手写事实 | `tests/app/goal-fan-out-driver.test.ts`<br>244-445<br>Goal fan-out re-drive (§2.3 GOAL-14, GOAL-28)（3 tests，:355/:391/:433） | resumeWorld（:281-352）手写 GoalSnapshot（:282-284）、带 executionAuthorization.phase='entered' 的 RunSnapshot（:288-291）、ControlIntentSnapshotV1（fanOutIntent，:267-274），再通过假 RunControlPort（:298-314）与假 goals/plans/executions/runtime 端口交给真实 createGoalFanOutDriver；这是 coordinator-mode 禁止的“builds a state object and hands it to a reader or a stand-in”。真实公开路径存在：tests/scenarios/A7-control-goal29.test.ts:45-60 用 openHostScenario + script.replies + goalControlled 产生真实 entered Run 与 Goal pause；:206-221 用真实 createGoalFanOutDriver 跑同一 fan-out。 | convert:Host 启动 + scripted model 回复 + Goal pause（存在；A7-control-goal29 已用该路径） | 入口已存在：tests/scenarios/A7-control-goal29.test.ts:45-60,206-221 | 178 | — | 中 |
| E1-24（P3-04） | 手写事实 | `tests/app/host-settings.test.ts`<br>833-894<br>HOST settings workspace check approval (R6 cold-start): uses authoritative saved proposal facts… | save()（:875-880）把 {answerRef, answerDigest, checks} 直接写进测试自己的 proposals Map，假 readCheckProposal（:855-863）再把它当“已保存 Answer”返回给 createHostSettings；随后 settings.call('checks/approve', inputA)（:882）。真实生产路径是 src/app/host.ts:979-999 从 platform.queries.readQueryAnswer 读已保存 Answer，再用 parseInitialPlanningResponseV2 解出 setup checks；src/app/host-settings.ts:748-783 是同一 route 的真实实现。公开步骤存在：Host + scripted model 的 queries/start 保存 Answer，再走 settings checks/approve。 | convert:Host queries/start（scripted model）+ settings checks/approve（存在） | 入口已存在：src/app/host.ts:979-999、src/app/host-settings.ts:748-783 | 62 | — | 高 |
| E1-25（P3-05） | 手写事实 | `tests/app/change-emitters.test.ts`<br>53-63,84-113,125-259<br>collaboration driver change notices（6 tests） | yielded（:54-57）、completed（:58）、startRunInput（:60-63）是测试手写的 WorkflowAdvanceResult；driverWith（:84-113）让假 workflow.advanceWork 直接返回这些对象来驱动 createCollaborationDriver 发 notice。真实 Workflow advance 已在 tests/business/K3-46-review-advance-failures.test.ts:549-575 用 workflow.advanceWork.bind(workflow) 驱动同一 driver；Host 启动会接上 onChange（src/app/host.ts）。 | convert:real Workflow.advanceWork（Host 启动 + scripted model；K3-46 已用） | 入口已存在：tests/business/K3-46-review-advance-failures.test.ts:549-575 | 150 | — | 中 |
| E1-26（P1-07） | 辅助 | `tests/app/A2-continuation-projection.test.ts, tests/app/A2-requeue-route.test.ts, tests/app/A2-reverify-route.test.ts`<br>A2-continuation-projection:46-80; A2-requeue-route:45-82; A2-reverify-route:45-74<br>TD-5…；tasks/requeue and executions/brief…；verification/reverify… | 三文件各自重写 post/workRow/readRun/advance/select/control/driveWorkflow。post 与 tests/helpers/A2-restart-fixture.ts:64-69 逐字节相同，workRow 与 :111-118 相同，readExecution（:120-124）与各文件 readRun 等价；同批 tests/app/A2-automation-verdict.test.ts:45 已从该夹具 import 同名 helper，说明共享夹具是既定复用点。advance/select/driveWorkflow 仍有本地差异，需参数化后合并。 | merge-into:tests/helpers/A2-restart-fixture.ts::post/workRow/readExecution/driveWorkflow | tests/helpers/A2-restart-fixture.ts:64-130（已存在的共享 helper） | 80 | — | 高 |
| E1-27（P1-08） | 辅助 | `tests/app/A2-runtime-capabilities.test.ts, tests/app/K-R-runtime-capabilities.test.ts`<br>A2-runtime-capabilities:60-97; K-R-runtime-capabilities:39-74<br>reports continuation, safe-point pause, cancel and start-up reconciliation…；KA-17 reports… | directory()/startHost()/readCapabilities() 两处逐行 diff 只有 a2-* 对 ka17-* 的 id/名称差异，其余 Host 启动与能力读取代码完全相同（约 35 行）。抽到 tests/helpers 后两文件共用一份。 | merge-into:抽到 tests/helpers（A2 与 K-R 共用 startHost/readCapabilities） | 同一构造器的另一份（两文件各存一份） | 35 | — | 高 |
| E1-28（P1-09） | 辅助 | `tests/app/AG2-consultation.test.ts, tests/app/R6-host.test.ts`<br>AG2-consultation:115-179; R6-host:621-708（另 R6-host:106-135）<br>answers the original question…；loads a real startup JSON… | 两段是同一 R6 execution-entry Host 构造器：临时 root/db/config、src/module.ts、tsconfig.json、vendor skills root、ProviderRegistry + createScriptedModel、runtime/workflow 配置、写 workbench.json、loadWorkbenchCliConfig、createLocalWorkbenchHost、读 token。AG2 头自述 reuses the R6 execution-entry Host fixture pattern（:20-23）；tests/helpers/AG2b-collaboration-fixture.ts:5-7 也自述复用同一 pattern，即已有第三个副本（startAG2bHost，:186）。两处参数面不同（R6 另有 checks 与两个 binding），合并成本较大。 | merge-into:tests/helpers/AG2b-collaboration-fixture.ts::startAG2bHost（参数化 runtime/checks/replies） | tests/helpers/AG2b-collaboration-fixture.ts:186（同 pattern 的共享夹具） | 100 | — | 中 |
| E1-29（P2-08） | 辅助 | `tests/app/S2B-41-decision54-backfill-bound.test.ts`<br>81-85,108-126<br>2B-41 (BE3): the automatic backfill bounds A by its own closed Turn… | 本地 withTool（:108-115）与共享夹具 tests/helpers/S2B-be2-reconcile-support.ts:82-92 逐字相同；controlsOn（:117-126）与同文件 :71-80 只差 eventId 前缀（s2b-41- 对 s2b-be2-）。本文件已从 S2B-runtime-tools-support import restartedHost（:45），共享夹具是既定复用点；删除后少 import createRunControlService/createMaterialRecordReaders/createRunStateReader（:35-39）。 | merge-into:tests/helpers/S2B-be2-reconcile-support.ts::withTool/controlsOn | tests/helpers/S2B-be2-reconcile-support.ts:71-92 | 22 | — | 高 |
| E1-30（P2-09） | 辅助 | `tests/app/S2B-41…, S2B-be2-late-evidence-activity, S2B-be2-run23-activity, S2B-be2-startup-reconcile-activity, S2B-r2-backfill-probe-first, S2B-r2-r6-probe-verdicts, S2B-backfill-workflow, S2B-r2-backfill-done-cursor, S2B-r2-backfill-identity, S2B-r2-backfill-revision-race, S2B-r2-backfill-real-kernel`<br>deferred 6 处；viewOf 5 处；readPageToken 2 处；until 2 处（详见证据）<br>2B 组本地 helper（无单独 test 名） | deferred 6 份（S2B-41:81、S2B-be2-late-evidence-activity:40、S2B-be2-run23-activity:35、S2B-be2-startup-reconcile-activity:41、S2B-r2-backfill-probe-first:32、S2B-r2-r6-probe-verdicts:29）；viewOf 5 份（S2B-backfill-workflow:91、S2B-r2-backfill-done-cursor:34、S2B-r2-backfill-identity:52、S2B-r2-backfill-revision-race:31、S2B-r2-backfill-real-kernel:67）；readPageToken 2 份（S2B-35-activity-routes:108、S2B-r2-backfill-real-kernel:75）；until 2 份（S2B-backfill-host:58、S2B-r2-backfill-real-kernel:58）。deferred 已有导出 tests/helpers/A2-restart-fixture.ts:192；readPageToken 在 tests/helpers/AG2b-collaboration-fixture.ts:275 有导出且 S4C-record-note-host:113 在用；viewOf/until 可放已存在的 tests/helpers/S2B-r2-activity-support.ts。 | merge-into:tests/helpers/S2B-r2-activity-support.ts + tests/helpers/A2-restart-fixture.ts::deferred | 各文件现有 import 点 | 70 | — | 高 |
| E1-31（P3-07） | 辅助 | `tests/app/S8A-L8-capture-start.test.ts`<br>114-117,120,150-154<br>openPlatform / PlatformAdapters（测试支撑代码） | PlatformAdapters（:114-117）与 openPlatform 第三参 adapters（:120）只在本文件声明；全 tests/ 与 src/ 搜 PlatformAdapters 只有这两处，RawArtifactStorePort 只为此类型导入（:28）。文件内所有 openPlatform 调用（:216,235,256,272,285,313,393,413）最多传两个参数，:150-154 的 adapters?.bodies 分支永远走不到。 | delete | 无（未被任何测试使用） | 6 | — | 高 |
| E1-32（P3-08） | 辅助 | `tests/app/support/S8A-L8-host.ts`<br>32,58,175,177-178,295<br>shared helper exports（无 test 名） | Started（:32）、delay（:58）、plain（:175）、StateReply（:177-178）、CaptureGateEntry（:295）都带 export，但只有 4 个测试 import 该 helper（S8A-L8-auto-capture-host:17、S8A-L8-host-close-restart:27、S8A-L8-host-restart:21、S8A-L8-http-watermark:18），四处 import 清单都没有这 5 个名字；它们只在模块内部使用。 | delete（去掉这 5 个名字的 export，本地定义保留） | 无（未被任何测试使用） | 5 | — | 高 |

说明：`keep-note` 表示本轮只登记、不改测试（多为冻结规格行或需要 lead 先定合并去向），因此估计行数为 0；`delete`/`merge-into`/`convert` 的估计行数是测试改动或删除的行数。

## 2. JSON

```json
[
  {
    "id": "E1-01",
    "category": "stale",
    "file": "tests/app/MVP-ui-entry.test.ts",
    "lines": "261-273",
    "tests": "keeps display ids per scope and migrates only the explicit v1 scopeKey（v1 迁移子块）",
    "evidence": "测试用 `DISPLAY_PREFERENCE_V1_KEY` 造 v1 记录并断言迁移到 scopeA、readGlobal 也迁移（MVP-ui-entry:261-273）。生产侧 src/ui/state/display-preference.ts:16 标为 Legacy single-record key，:108 读旧键，:119-134 是 v1 迁移分支。决定 79-1（docs/refactor/HANDOFF.md:565-570）要求只读当前格式、不写迁移、不留旧版本解码分支，并点名写进配置的旧格式按本条重看；产品从未真实运行。",
    "action": "delete",
    "covered_by": "行为已不存在：发布前无旧数据（决定 79-1；清理时同删 src/ui/state/display-preference.ts:16,108,119-134 的 v1 迁移）",
    "est_lines": 14,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-02",
    "category": "stale",
    "file": "tests/app/S0-attention-edge-label.test.ts",
    "lines": "41-96",
    "tests": "S0-01 writes the requirement kind and label into the depends edge, not [object Object]；S0-02…；S0-03…",
    "evidence": "scan() 只给 plans.queryTaskGraph（S0:52-53），是 slice 0 的旧 seam。src/app/attention-observer.ts:651-655 在 readAttentionGraph 存在时明确不再走 plans/catalog 旧读法；真实 Host 总会注入该读法（src/app/host.ts:1444-1446），组合根总会提供包装（src/composition/create-platform.ts:1509-1515）。当前入口的同一 depends:kind:label 断言在 tests/app/S3-attention-context.test.ts:300-333（AT04，readAttentionGraph seam）。",
    "action": "convert:createAttentionScanner 的 readAttentionGraph seam（同 tests/app/S3-attention-context.test.ts:300-333）",
    "covered_by": "tests/app/S3-attention-context.test.ts:300-333（AT04，其他片）",
    "est_lines": 15,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-03",
    "category": "stale",
    "file": "tests/app/S2B-backfill-workflow.test.ts, tests/app/S2B-backfill-host.test.ts",
    "lines": "S2B-backfill-workflow:122-125,236,355; S2B-backfill-host:71-74",
    "tests": "2B-16 automatic backfill covers only [now-14d, now)…；2B-18…；2B-42 an old Run…",
    "evidence": "这些 Run 都结束在“开始记录”之前：workflow:113 注释写明“Four executions ended 2, 13, 15 and 30 days before the recording epoch”，:126 才 ensureRecording；host:71-74 也先造结束 Run 再启动写 epoch 的 Host（:91-97）。2B 以后任何 Run 都由持租约的 Host 创建，Host 启动第一件事是写 ActivityRecording（S2B-activity-fixture.ts:551-557），新库不可能出现“结束早于 epoch”的 Run。79-1（HANDOFF:565-570）下这是只在开发库存在的旧数据态；行为本身（补算无记录 Run）仍由 2B-19/2B-41 覆盖。",
    "action": "keep-note",
    "covered_by": "行为仍在：tests/app/S2B-backfill-workflow.test.ts:290-330（2B-19）、tests/app/S2B-41-decision54-backfill-bound.test.ts:128-287（2B-41）",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "E1-04",
    "category": "duplicate",
    "file": "tests/app/K-R-runtime-capabilities.test.ts",
    "lines": "76-113",
    "tests": "KA-17 reports that a Work line continues in the same Session…",
    "evidence": "K-R 头自述“It is the group R copy of the KA-17 assertions and never edits the frozen file”（K-R:9-11）。两边都经真实 Host POST runtime/capabilities：kernelSessionApiVersion===3（A2:164 对 K-R:112）、same-Session-after-close 与 new-Session-when-not-possible（A2:125-126 对 K-R:90-101）重复；K-R 多 L8 fallback 逐句。K-R 是 KA-17 行钉子，保留；若要合并，只删 A2:164,125-126 这组重复断言（约 8 行），A2 的 5.2/5.4 独有句保留。",
    "action": "keep-note",
    "covered_by": "tests/app/A2-runtime-capabilities.test.ts:144-233（另一份；A2 保留 5.2/5.4 独有断言）",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "E1-05",
    "category": "duplicate",
    "file": "tests/app/R6-workbench.test.ts",
    "lines": "302-368（历史子块）",
    "tests": "projects real original history in order and keeps task hierarchy separate from execution dependencies and real work links",
    "evidence": "同一 renderSessionHistoryTimeline。R6 重复 session-rendering 的断言：用户/助手正文与原始顺序（R6:353-355,366 对 session-rendering:395-405）、raw disclosure 默认收起（R6:357-360 对 :428-430）、未知记录保留（R6:362 对 :432-433）、cursor/position 保留（R6:363-365 对 :434-435）。session-rendering 是更完整的渲染契约；R6 该 test 后半段任务层级/依赖、work link、execution entry（:370-479）无别处覆盖，须保留。",
    "action": "merge-into:tests/app/session-rendering.test.ts::keeps every original record reachable in raw form and in original order",
    "covered_by": "tests/app/session-rendering.test.ts:395-440（其他片）",
    "est_lines": 40,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E1-06",
    "category": "duplicate",
    "file": "tests/app/S2B-backfill-host.test.ts",
    "lines": "68-137",
    "tests": "2B-16 the leased Host records the epoch before reconcile and auto-backfills only the last 14 days",
    "evidence": "同一 2B-16 行三份：本文件 68-137、tests/app/S2B-r2-backfill-real-kernel.test.ts:96-134、tests/app/S2B-backfill-workflow.test.ts:118-181。real-kernel 已覆盖 Host 写 epoch、只补 14 天、区间外 not_backfilled（:103-130）；workflow 覆盖重启不再写（:172-180）。本文件独有 recordingSince 字面值（:92-97）、空 Kernel→显式 unknown（:113-115）、第二次 Host 启动不再写（:121-136），故三份不能直接互删；若合并，先搬走这三条。",
    "action": "keep-note",
    "covered_by": "三份互相覆盖：tests/app/S2B-r2-backfill-real-kernel.test.ts:96-134、tests/app/S2B-backfill-workflow.test.ts:118-181",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "E1-07",
    "category": "duplicate",
    "file": "tests/app/S2B-r2-backfill-revision-race.test.ts",
    "lines": "55-88",
    "tests": "R13 a write that lands after selection makes the backfill report skipped/record_changed",
    "evidence": "与 tests/runtime/S2B-44-backfill-late-evidence-race.test.ts:87-215（规格行 2B-44，其他片）同一场景同一断言：补算按选中 revision 写时被更晚的写抢先→skipped/record_changed（本文件 :83 对 S2B-44:154）。2B-44 用真 RUN-21 与在 RecordStore 边界停住提交（:127-170），更接近真实路径；本文件 :90-109 的 unchanged 用例无别处覆盖，保留。",
    "action": "merge-into:tests/runtime/S2B-44-backfill-late-evidence-race.test.ts::2B-44",
    "covered_by": "tests/runtime/S2B-44-backfill-late-evidence-race.test.ts:87-215（其他片，规格行 2B-44）",
    "est_lines": 34,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E1-08",
    "category": "duplicate",
    "file": "tests/app/S2B-35-activity-routes.test.ts",
    "lines": "256-276",
    "tests": "2B-35 (c) activity/backfill is forbidden for members and platform automation",
    "evidence": "同一准入 isHumanHost（src/business/workflow/activity-backfill.ts:249-252）在两处用同一组 forbidden 验证：本文件成员 query_run + system 自动化；tests/app/S2B-backfill-workflow.test.ts:332-350（2B-20）work_run 成员 + 同一 system 自动化（:333-349）。路由层无自己的检查，src/app/core-routes.ts:1157 只把 ctx 与 input 原样转给 bindings.backfillActivityRange，所以 (c) 只是多一层转发的第二次调用。",
    "action": "keep-note",
    "covered_by": "tests/app/S2B-backfill-workflow.test.ts:332-350（2B-20）",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "E1-09",
    "category": "duplicate",
    "file": "tests/app/S8A-L8-capture-start.test.ts",
    "lines": "215-231,255-269",
    "tests": "a rejected start state read goes to the failure exit with its code and reason；a start state read that throws maps to unavailable while the signal is not aborted",
    "evidence": "两处注入 start observation-state 读失败（:218-220 返回 rejected/forbidden，:258 抛错），断言同一 failure exit：requestSeq 1、status failed、pending true 与 code/reason（:225-229、:263-267）。tests/work-graph/S8A-L8-observation-state.test.ts:671-693（L8-7）与 :695-715（L8-8）覆盖同一场景，并用 start revision 保护与旧观测保留断言（:687-692、:708-713）；capture-start 独有的是 forbidden code 透传，可作为 L8-7 的变体并入。",
    "action": "merge-into:tests/work-graph/S8A-L8-observation-state.test.ts::L8-7/L8-8",
    "covered_by": "tests/work-graph/S8A-L8-observation-state.test.ts:671-715（其他片，L8-7/L8-8）",
    "est_lines": 24,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E1-10",
    "category": "duplicate",
    "file": "tests/app/S8A-L8-capture-start.test.ts",
    "lines": "310-361",
    "tests": "L8 capture start cancellation [memory|sqlite]: writes nothing when the start state read is cancelled while it rejects/throws/ready",
    "evidence": "cancellationCase（:311-357）在 close 时让 held start read 分别失败/抛错/返回 ready，断言 requestSeq 1、status requested、pending true、current null、counts.failure=0/capture=0/state=1（:347-354）。同一三例由 tests/work-graph/S8A-L8-observation-state.test.ts:717-743（L8-9）、:745-769（L8-10）、:771-796（L8-11）覆盖，且 L8-9/10/11 另断言旧观测保留（:741、:767、:793）。capture-start 的调用计数可并入。",
    "action": "merge-into:tests/work-graph/S8A-L8-observation-state.test.ts::L8-9/L8-10/L8-11",
    "covered_by": "tests/work-graph/S8A-L8-observation-state.test.ts:717-796（其他片，L8-9/10/11）",
    "est_lines": 52,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-11",
    "category": "duplicate",
    "file": "tests/app/S8A-architecture-routes.test.ts",
    "lines": "111-176",
    "tests": "A-02b: one successful compare-formal request returns the two exact findings",
    "evidence": "与 tests/composition/S8A-AE1-formal-comparison.test.ts:165-189 的 A-02b 同一 fixture（src/a/one.ts 与 src/b/lib.ts，同一 A→B catalog）和逐字相同的两条 findings：route 侧 :167-172 对 AE1:182-185（cycle detail 'src/a/one.ts ⇄ src/b/lib.ts'；import_undeclared detail 'src/a/one.ts'）。route 测试独有的是 HTTP architecture/compare-formal 路径（:156-166），AE1 独有的是 memory/sqlite 两后端。",
    "action": "merge-into:tests/composition/S8A-AE1-formal-comparison.test.ts::AE1 A-02b public cycle comparison",
    "covered_by": "tests/composition/S8A-AE1-formal-comparison.test.ts:165-189（其他片，A-02b）",
    "est_lines": 15,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "E1-12",
    "category": "duplicate",
    "file": "tests/app/change-feed.test.ts",
    "lines": "57-123",
    "tests": "Last-Event-ID resume decision（4 tests）",
    "evidence": "与 tests/app/change-stream.test.ts:145-181 断言同一组 resume 决策：最新 cursor ready（feed:72-76 对 stream:158）、窗口内 gap 合并成一条 change（feed:77-84 对 stream:159-162）、cursor_too_old（feed:89-90,102 对 stream:165-166）、cursor_unknown（feed:91-92 对 stream:167-168）、cursor_invalid（feed:93-96 对 stream:169-170）。feed 独有的是空账本/head_unknown（:107-123）与多事件 commit 内部 cursor 的精确断言（:81-84）；ring eviction 两边都有（feed:99-105 对 stream:164-166），合并时保留 stream 侧即可。若按 unit/integration 分层保留，降为 keep-note。",
    "action": "merge-into:tests/app/change-stream.test.ts::change stream Last-Event-ID resume",
    "covered_by": "tests/app/change-stream.test.ts:145-181",
    "est_lines": 35,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E1-13",
    "category": "trivial",
    "file": "tests/app/orchestration-mechanism.test.ts",
    "lines": "28-34",
    "tests": "produces no delivery and no model work when nothing changed",
    "evidence": "三条断言 observe(snapshot,0)===null、observe(snapshot,10_000)===null、observer.processed===null，与 tests/app/S3-attention-context.test.ts:238-248（AT01）相同；AT01 另断言 Host send 计数为 0（:238-248）。该纯 observer 无变化用例不增加覆盖。",
    "action": "delete",
    "covered_by": "tests/app/S3-attention-context.test.ts:238-248（AT01，其他片）",
    "est_lines": 7,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-14",
    "category": "trivial",
    "file": "tests/app/S4C-record-note-host.test.ts",
    "lines": "42-47",
    "tests": "RW-1 a write-enabled workspace grants record_note with the mailbox tools",
    "evidence": "三条断言中的 record_note 由同一文件真 Host 用例在 :169-170 断言（started.scripted.requests[0].tools 含 record_note，而该 binding 的 grant 正是 :89 的 localWorkbenchGrant）；write/send_session_message 与 record_note 同属 :41 的同一 tools 列表，但业务测试只直接断言 record_note，故这一条按 keep-note 处理、不直接删。:49-54 的“无写前缀不授予”是真 Host 用例造不出的反例，保留。",
    "action": "keep-note",
    "covered_by": "tests/app/S4C-record-note-host.test.ts:169-170（真 Host 请求 tools）",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E1-15",
    "category": "trivial",
    "file": "tests/app/S4C2-scribe-reminders.test.ts",
    "lines": "719-730",
    "tests": "S4C2 real recipient resolver: two scribes, the smallest session id wins",
    "evidence": "断言两个 scribe 取较小 session id；同一文件 D-03 已用真 Host + 字面 session id 断言提醒只发给较小的：D03_LOWEST_SESSION（:465）、sent[0].requestId === D03_LOWEST_REQUEST_ID（:485）、inboxOfRef(lowest) 1 条 / remaining 0 条（:488-489）。resolver 规则一改 D-03 即失败，该单测无额外分支。",
    "action": "delete",
    "covered_by": "tests/app/S4C2-scribe-reminders.test.ts:471-509（D-03）",
    "est_lines": 12,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E1-16",
    "category": "trivial",
    "file": "tests/app/S2C-line-routes.test.ts",
    "lines": "166-170",
    "tests": "2C-31 (d) lines/list returns exactly the LE3 WorkLineReadPort value",
    "evidence": "只有一句 expect(await routeList(...)).toEqual(direct)；(h) 在同一 composed bindings 上对 D1 数据集再断言一次 routeList === directList（:301-302），且还覆盖 archived/read/page。只为 (d) 存在的小 fixture 在 :154-159，但 (e) 的失败注入仍用它（:172-181），故只删 (d) 的 test，不删 fixture。",
    "action": "merge-into:tests/app/S2C-line-routes.test.ts::2C-31 (h)",
    "covered_by": "tests/app/S2C-line-routes.test.ts:299-302（2C-31 (h)）",
    "est_lines": 6,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-17",
    "category": "trivial",
    "file": "tests/app/S8A-L8-http-watermark.test.ts",
    "lines": "60-82",
    "tests": "the same capture body without requestSeq still commits a real observation",
    "evidence": "与 tests/app/S8A-L8-auto-capture-host.test.ts:168-186 的 “the manual architecture/capture route still works” 同一业务场景、同一断言：projects/create + workspaces/register 后手动 POST architecture/capture（{workspace, mappings: [], previous: null}），断言 committed、current.captureId 改变、requestSeq 不变、pending false（watermark:71-80 对 host:175-183）；watermark 侧 :69 另断言 baselineSeq===1。该文件保留 reject 行即可。",
    "action": "merge-into:tests/app/S8A-L8-auto-capture-host.test.ts::the manual architecture/capture route still works",
    "covered_by": "tests/app/S8A-L8-auto-capture-host.test.ts:168-186",
    "est_lines": 23,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-18",
    "category": "handwritten",
    "file": "tests/app/A2-startup-redrive-select.test.ts",
    "lines": "34-130",
    "tests": "§12.1 step 6b (a): only a required active Task with a pending verdict selects its Goal；…an unreadable Task graph is a problem…",
    "evidence": "测试用 goalOf（:34-38）手搓 GoalSnapshot，用 graphOf（:49-55）造带 failure.automation.verdict 的 TaskRow（:52-53），经假 plans.queryTaskGraph / listGoals 返回（:64-85），文件头自述“over controlled doubles of the reconcile seam”（:3-5）。coordinator-mode 禁止“builds a state object and hands it to a reader or a stand-in”（.dsh-ref/coordinator-mode.md:45-51）。真实入口已存在：tests/scenarios/A8-host-restart.test.ts:420-457 用真实 Host 启动核对验证同一启动重驱（W-11）；转换保留判定矩阵断言。",
    "action": "convert:Host 启动 + scripted model + 真实 FAIL/requeue/reverify 步骤（tests/scenarios/A8-host-restart.test.ts:420-457 的 openHostScenario 模式）",
    "covered_by": "tests/scenarios/A8-host-restart.test.ts:420-457（入口已存在）",
    "est_lines": 55,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-19",
    "category": "handwritten",
    "file": "tests/app/S2B-backfill-workflow.test.ts",
    "lines": "67-89,236,355",
    "tests": "2B-18 backfill writes unknown…；2B-42 an old Run with no locator and no authorization…",
    "evidence": "commitLegacyRun 手拼 RunSnapshot（status ended、startedAt null、无授权、无 position record）后 commitRaw 直写（:83-86）。公开步骤存在：同一夹具 claimThenCancel（tests/helpers/S2B-activity-fixture.ts:528-541）用真实 claimTask + runControl 取消，注释写明 RUN-09 未进入；规格 2B-42 原文要求“领取以后、授权以前就取消”（slice-2B-SPEC.md:793）。claim+cancel 后 startedAt 仍空、无授权，endedAt<since 时 provenNotEnteredKernel 为 false（src/contracts/run-activity.ts:91-107），期望值不变。",
    "action": "convert:claimThenCancel（tests/helpers/S2B-activity-fixture.ts:529，今天存在）",
    "covered_by": "转换后同一断言不变",
    "est_lines": 25,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-20",
    "category": "handwritten",
    "file": "tests/app/S2B-r2-backfill-done-cursor.test.ts",
    "lines": "44-65,81,84-88",
    "tests": "R9 the batch-full probe keeps a non-null continuation instead of declaring done",
    "evidence": "同一份 commitLegacyRun 直写 RunSnapshot（:59-62），101 条 counted 用 seedLegacyActivity（tests/helpers/S2B-activity-fixture.ts:302-324，内部 commitRaw 写 RunSnapshot）。真实路径存在：runAndEnd（:515-520，真实 claim/enter/end）+ 公开 writeActivity（:543-549）；但夹具计划只有 12 个 work task（:72-73），今天造不出 103 个真实 Run，需把 adoptInitialPlan 的任务表扩到 ≥103（:355-388 已是公开 Plan 路径）。101 次真实 Run 有耗时风险。",
    "action": "convert:真实 runAndEnd ×103 + 公开 writeActivity（夹具计划需扩到 ≥103 任务）",
    "covered_by": "同一文件 R9 断言不变",
    "est_lines": 31,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E1-21",
    "category": "handwritten",
    "file": "tests/app/S2B-41-decision54-backfill-bound.test.ts",
    "lines": "218-223",
    "tests": "2B-41 (BE3): the automatic backfill bounds A by its own closed Turn, excludes B, and is not capacity",
    "evidence": "测试用 fx.deps.kernelStores.withStore + vendor closeOpenTurn 直接关 A 的 Turn（:218-223），绕过 K 片 A 的公开操作。公开步骤存在：RuntimeExecutionPort.closeOpenTurn（src/core/agent-runtime/runtime.ts:135-144，先复核 Run/授权/Session 事实再调同一 Kernel seam），Workflow 的 close_open_turn 步（src/business/workflow/workflow.ts:1311）就调它；规格 2B-41 原文指的是这条 Runtime 操作（slice-2B-SPEC.md:792）。转换可能需 RUN-24 requeue 证明（runtime.ts:159-183），未实跑验证。",
    "action": "convert:RuntimeExecutionPort.closeOpenTurn（今天存在；可能需补 RUN-24 requeue 事实）",
    "covered_by": "转换后 countedThroughTurnEnd:true 断言不变",
    "est_lines": 6,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "E1-22",
    "category": "handwritten",
    "file": "tests/app/S2B-backfill-workflow.test.ts",
    "lines": "325-329",
    "tests": "2B-19 a Run that ended after recording began but has no tally…",
    "evidence": "f.writeActivity(failed, unknownFacts('history_read_failed', …)) 直接写结束时的 unknown 事实；该事实本应由结束那次 Kernel 重读失败产生（规格 2B-08 行，真路径 tests/composition/S2B-be1-counting-failure.test.ts:78）。这里只测“补算把它换成 recorded_late”。公开步骤存在，但 S2BActivityFixture.end()（tests/helpers/S2B-activity-fixture.ts:488-513）没有 Kernel 重读失败接缝，需补一个 fault 包装；故把握低。",
    "action": "convert:ExecutionEntryPort.recordRunResult + 一次 Kernel 历史读失败（2B-08 路径；夹具需补接缝）",
    "covered_by": "tests/composition/S2B-be1-counting-failure.test.ts:78（其他片，生产路径）",
    "est_lines": 2,
    "spec_row": true,
    "confidence": "低"
  },
  {
    "id": "E1-23",
    "category": "handwritten",
    "file": "tests/app/goal-fan-out-driver.test.ts",
    "lines": "244-445",
    "tests": "Goal fan-out re-drive (§2.3 GOAL-14, GOAL-28)（3 tests，:355/:391/:433）",
    "evidence": "resumeWorld（:281-352）手写 GoalSnapshot（:282-284）、带 executionAuthorization.phase='entered' 的 RunSnapshot（:288-291）、ControlIntentSnapshotV1（fanOutIntent，:267-274），再通过假 RunControlPort（:298-314）与假 goals/plans/executions/runtime 端口交给真实 createGoalFanOutDriver；这是 coordinator-mode 禁止的“builds a state object and hands it to a reader or a stand-in”。真实公开路径存在：tests/scenarios/A7-control-goal29.test.ts:45-60 用 openHostScenario + script.replies + goalControlled 产生真实 entered Run 与 Goal pause；:206-221 用真实 createGoalFanOutDriver 跑同一 fan-out。",
    "action": "convert:Host 启动 + scripted model 回复 + Goal pause（存在；A7-control-goal29 已用该路径）",
    "covered_by": "入口已存在：tests/scenarios/A7-control-goal29.test.ts:45-60,206-221",
    "est_lines": 178,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E1-24",
    "category": "handwritten",
    "file": "tests/app/host-settings.test.ts",
    "lines": "833-894",
    "tests": "HOST settings workspace check approval (R6 cold-start): uses authoritative saved proposal facts…",
    "evidence": "save()（:875-880）把 {answerRef, answerDigest, checks} 直接写进测试自己的 proposals Map，假 readCheckProposal（:855-863）再把它当“已保存 Answer”返回给 createHostSettings；随后 settings.call('checks/approve', inputA)（:882）。真实生产路径是 src/app/host.ts:979-999 从 platform.queries.readQueryAnswer 读已保存 Answer，再用 parseInitialPlanningResponseV2 解出 setup checks；src/app/host-settings.ts:748-783 是同一 route 的真实实现。公开步骤存在：Host + scripted model 的 queries/start 保存 Answer，再走 settings checks/approve。",
    "action": "convert:Host queries/start（scripted model）+ settings checks/approve（存在）",
    "covered_by": "入口已存在：src/app/host.ts:979-999、src/app/host-settings.ts:748-783",
    "est_lines": 62,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-25",
    "category": "handwritten",
    "file": "tests/app/change-emitters.test.ts",
    "lines": "53-63,84-113,125-259",
    "tests": "collaboration driver change notices（6 tests）",
    "evidence": "yielded（:54-57）、completed（:58）、startRunInput（:60-63）是测试手写的 WorkflowAdvanceResult；driverWith（:84-113）让假 workflow.advanceWork 直接返回这些对象来驱动 createCollaborationDriver 发 notice。真实 Workflow advance 已在 tests/business/K3-46-review-advance-failures.test.ts:549-575 用 workflow.advanceWork.bind(workflow) 驱动同一 driver；Host 启动会接上 onChange（src/app/host.ts）。",
    "action": "convert:real Workflow.advanceWork（Host 启动 + scripted model；K3-46 已用）",
    "covered_by": "入口已存在：tests/business/K3-46-review-advance-failures.test.ts:549-575",
    "est_lines": 150,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E1-26",
    "category": "helper",
    "file": "tests/app/A2-continuation-projection.test.ts, tests/app/A2-requeue-route.test.ts, tests/app/A2-reverify-route.test.ts",
    "lines": "A2-continuation-projection:46-80; A2-requeue-route:45-82; A2-reverify-route:45-74",
    "tests": "TD-5…；tasks/requeue and executions/brief…；verification/reverify…",
    "evidence": "三文件各自重写 post/workRow/readRun/advance/select/control/driveWorkflow。post 与 tests/helpers/A2-restart-fixture.ts:64-69 逐字节相同，workRow 与 :111-118 相同，readExecution（:120-124）与各文件 readRun 等价；同批 tests/app/A2-automation-verdict.test.ts:45 已从该夹具 import 同名 helper，说明共享夹具是既定复用点。advance/select/driveWorkflow 仍有本地差异，需参数化后合并。",
    "action": "merge-into:tests/helpers/A2-restart-fixture.ts::post/workRow/readExecution/driveWorkflow",
    "covered_by": "tests/helpers/A2-restart-fixture.ts:64-130（已存在的共享 helper）",
    "est_lines": 80,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-27",
    "category": "helper",
    "file": "tests/app/A2-runtime-capabilities.test.ts, tests/app/K-R-runtime-capabilities.test.ts",
    "lines": "A2-runtime-capabilities:60-97; K-R-runtime-capabilities:39-74",
    "tests": "reports continuation, safe-point pause, cancel and start-up reconciliation…；KA-17 reports…",
    "evidence": "directory()/startHost()/readCapabilities() 两处逐行 diff 只有 a2-* 对 ka17-* 的 id/名称差异，其余 Host 启动与能力读取代码完全相同（约 35 行）。抽到 tests/helpers 后两文件共用一份。",
    "action": "merge-into:抽到 tests/helpers（A2 与 K-R 共用 startHost/readCapabilities）",
    "covered_by": "同一构造器的另一份（两文件各存一份）",
    "est_lines": 35,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-28",
    "category": "helper",
    "file": "tests/app/AG2-consultation.test.ts, tests/app/R6-host.test.ts",
    "lines": "AG2-consultation:115-179; R6-host:621-708（另 R6-host:106-135）",
    "tests": "answers the original question…；loads a real startup JSON…",
    "evidence": "两段是同一 R6 execution-entry Host 构造器：临时 root/db/config、src/module.ts、tsconfig.json、vendor skills root、ProviderRegistry + createScriptedModel、runtime/workflow 配置、写 workbench.json、loadWorkbenchCliConfig、createLocalWorkbenchHost、读 token。AG2 头自述 reuses the R6 execution-entry Host fixture pattern（:20-23）；tests/helpers/AG2b-collaboration-fixture.ts:5-7 也自述复用同一 pattern，即已有第三个副本（startAG2bHost，:186）。两处参数面不同（R6 另有 checks 与两个 binding），合并成本较大。",
    "action": "merge-into:tests/helpers/AG2b-collaboration-fixture.ts::startAG2bHost（参数化 runtime/checks/replies）",
    "covered_by": "tests/helpers/AG2b-collaboration-fixture.ts:186（同 pattern 的共享夹具）",
    "est_lines": 100,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E1-29",
    "category": "helper",
    "file": "tests/app/S2B-41-decision54-backfill-bound.test.ts",
    "lines": "81-85,108-126",
    "tests": "2B-41 (BE3): the automatic backfill bounds A by its own closed Turn…",
    "evidence": "本地 withTool（:108-115）与共享夹具 tests/helpers/S2B-be2-reconcile-support.ts:82-92 逐字相同；controlsOn（:117-126）与同文件 :71-80 只差 eventId 前缀（s2b-41- 对 s2b-be2-）。本文件已从 S2B-runtime-tools-support import restartedHost（:45），共享夹具是既定复用点；删除后少 import createRunControlService/createMaterialRecordReaders/createRunStateReader（:35-39）。",
    "action": "merge-into:tests/helpers/S2B-be2-reconcile-support.ts::withTool/controlsOn",
    "covered_by": "tests/helpers/S2B-be2-reconcile-support.ts:71-92",
    "est_lines": 22,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-30",
    "category": "helper",
    "file": "tests/app/S2B-41…, S2B-be2-late-evidence-activity, S2B-be2-run23-activity, S2B-be2-startup-reconcile-activity, S2B-r2-backfill-probe-first, S2B-r2-r6-probe-verdicts, S2B-backfill-workflow, S2B-r2-backfill-done-cursor, S2B-r2-backfill-identity, S2B-r2-backfill-revision-race, S2B-r2-backfill-real-kernel",
    "lines": "deferred 6 处；viewOf 5 处；readPageToken 2 处；until 2 处（详见证据）",
    "tests": "2B 组本地 helper（无单独 test 名）",
    "evidence": "deferred 6 份（S2B-41:81、S2B-be2-late-evidence-activity:40、S2B-be2-run23-activity:35、S2B-be2-startup-reconcile-activity:41、S2B-r2-backfill-probe-first:32、S2B-r2-r6-probe-verdicts:29）；viewOf 5 份（S2B-backfill-workflow:91、S2B-r2-backfill-done-cursor:34、S2B-r2-backfill-identity:52、S2B-r2-backfill-revision-race:31、S2B-r2-backfill-real-kernel:67）；readPageToken 2 份（S2B-35-activity-routes:108、S2B-r2-backfill-real-kernel:75）；until 2 份（S2B-backfill-host:58、S2B-r2-backfill-real-kernel:58）。deferred 已有导出 tests/helpers/A2-restart-fixture.ts:192；readPageToken 在 tests/helpers/AG2b-collaboration-fixture.ts:275 有导出且 S4C-record-note-host:113 在用；viewOf/until 可放已存在的 tests/helpers/S2B-r2-activity-support.ts。",
    "action": "merge-into:tests/helpers/S2B-r2-activity-support.ts + tests/helpers/A2-restart-fixture.ts::deferred",
    "covered_by": "各文件现有 import 点",
    "est_lines": 70,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-31",
    "category": "helper",
    "file": "tests/app/S8A-L8-capture-start.test.ts",
    "lines": "114-117,120,150-154",
    "tests": "openPlatform / PlatformAdapters（测试支撑代码）",
    "evidence": "PlatformAdapters（:114-117）与 openPlatform 第三参 adapters（:120）只在本文件声明；全 tests/ 与 src/ 搜 PlatformAdapters 只有这两处，RawArtifactStorePort 只为此类型导入（:28）。文件内所有 openPlatform 调用（:216,235,256,272,285,313,393,413）最多传两个参数，:150-154 的 adapters?.bodies 分支永远走不到。",
    "action": "delete",
    "covered_by": "无（未被任何测试使用）",
    "est_lines": 6,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-32",
    "category": "helper",
    "file": "tests/app/support/S8A-L8-host.ts",
    "lines": "32,58,175,177-178,295",
    "tests": "shared helper exports（无 test 名）",
    "evidence": "Started（:32）、delay（:58）、plain（:175）、StateReply（:177-178）、CaptureGateEntry（:295）都带 export，但只有 4 个测试 import 该 helper（S8A-L8-auto-capture-host:17、S8A-L8-host-close-restart:27、S8A-L8-host-restart:21、S8A-L8-http-watermark:18），四处 import 清单都没有这 5 个名字；它们只在模块内部使用。",
    "action": "delete（去掉这 5 个名字的 export，本地定义保留）",
    "covered_by": "无（未被任何测试使用）",
    "est_lines": 5,
    "spec_row": false,
    "confidence": "高"
  }
]
```

## 3. 分类小计

| 类别 | 条数 | 估计行数 |
|---|---|---|
| 过时（stale） | 3 | 29 |
| 重复（duplicate） | 9 | 200 |
| 琐碎（trivial） | 5 | 48 |
| 手写事实（handwritten） | 8 | 509 |
| 只为篡改（tamper） | 0 | 0 |
| 辅助（helper） | 7 | 318 |
| **合计** | **32** | **1104** |

## 4. 核对与覆盖

**全读 78/78。** 三个子 agent 均逐文件标注“全读”，没有略读；文件分配：
- 第 1 部分（27）：A2-automation-verdict、A2-continuation-projection、A2-host-instance-lease、A2-requeue-route、A2-reverify-route、A2-runtime-capabilities、A2-settings-automation、A2-startup-redrive-select、AG2-consultation、AG2b-collaboration、AG6-agent-assembly、K-R-runtime-capabilities、K3-15-review-routes、K3-19-review-capability-host、MVP-ui-entry、MVP-workbench-tools、R6-host、R6-workbench、RL-33/34/40-43/44-resource-caps、S0-attention-edge-label、S1-session-routes、orchestration-mechanism、project-source-tool、reviewer-source-tools。
- 第 2 部分（26）：S2A-decision-routes、S2B-35-activity-routes、S2B-41-decision54-backfill-bound、S2B-backfill-host、S2B-backfill-workflow、S2B-be2-{late-evidence,run09,run18,run23,startup-reconcile}-activity、S2B-r2-backfill-{done-cursor,identity,probe-first,real-kernel,revision-race}、S2B-r2-r6-probe-verdicts、S2C-line-routes、S3-attention-context、S3-graph-routes、S4C-note-routes、S4C-record-note-host、S4C2-scribe-reminders、S5-decision-routes、S5R2-driver-safe-point、composition/WP2-wiring、composition/platform。
- 第 3 部分（25）：S8A-L8-{auto-capture-gate,auto-capture-host,capture-start,host-close-restart,host-restart,http-watermark}、S8A-architecture-routes、support/S8A-L8-host、change-{commit-observer,emitters,feed,stream}、exploration-tools、goal-conversation-start、goal-fan-out-driver、host-settings、session-rendering、settings-ui、ui-{actions,change-refetch,live-wiring,live,refresh,sse,store}。

**主控复核。** 32 条全部回到源行核对（不是只看子报告）：E1-01（v1 分支 src/ui/state/display-preference.ts:108,119-134 与测试）、E1-02（attention-observer:651-655、host:1444-1446）、E1-03（workflow:113-126 的“ended before the recording epoch”）、E1-04（K-R:9-11 自述 copy、两边 :164/:112 与 :125-126）、E1-05（R6:353-366 对 session-rendering:395-435）、E1-06（三份 2B-16 的 test 名与 Host:71-97）、E1-07（S2B-44:154 的 skipped/record_changed）、E1-08（2B-35(c) 与 2B-20:332-350 的同一 isHumanHost）、E1-09/E1-10（observation-state:671-796）、E1-11（AE1:182-185 的逐字 findings）、E1-12（change-stream:158-170）、E1-13（S3:238-248）、E1-14/E1-15、E1-16（2C-31 (d) 与 (h):301-302）、E1-17（host:175-183）、E1-18（A2-startup 的 Goal/TaskRow 与假 queryTaskGraph）、E1-19/E1-20/E1-22（commitLegacyRun、seedLegacyActivity、writeActivity）、E1-21（runtime.ts:135-144）、E1-23（resumeWorld:281-352 与 A7:45-60,206-221）、E1-24（host-settings:855-882 的 proposals Map 与 src/app/host.ts:979-999）、E1-25（change-emitters:54-63,84-113 与 K3-46:549-575）、E1-26…E1-30（helper 的逐行对比与 import 点）、E1-31（PlatformAdapters 全树只有 2 处）、E1-32（4 个 import 清单无这 5 个名字）。

**去重。** 合并时处理了三处同一文件/同一测试的多角度登记：E1-03 与 E1-06 都涉及三份 2B-16（前者是旧数据态，后者是重复覆盖，均 keep-note、0 行）；E1-04 与 E1-27 都涉及 K-R/A2 两个文件（前者是断言副本，后者是构造器副本，类别不同）；E1-09 与 E1-10 同在 capture-start 但对应 L8-7/8 与 L8-9/10/11 两组不同行。没有发现跨部分重复登记的同一 test。

**未定/不能下结论。**
1. 三份 2B-16 的合并去向未定（E1-06）：三份各有独有断言，2B 规格 §11 只写“补了”，没写“换掉”；若 lead 要砍，先定“第二次 Host 启动不再写”和“空 Kernel→显式 unknown”搬到哪。
2. E1-20 的代价：103 个真实 claim/enter/end 可能顶到 60 秒超时；若不接受，需显式写成“为分页保留的直写种子”，而不是悄悄保留。
3. E1-21 的转换可行性未实跑：RuntimeExecutionPort.closeOpenTurn 可能需 RUN-24 的 requeue 授权，而 restartedHost 的 W-20 是否写出该 requeue 未核实。
4. E1-14/E1-15 是否属返工项点名测试（resolver、RW-1 grant）未定；若是，应降为 keep-note。
5. 8A gate 的 close 行（S8A-L8-auto-capture-gate:383-392,461-524 与 S8A-L8-host-close-restart:103-139）高度重叠，但 L8 返工书 `docs/refactor/reviews/evidence/orchestration-slice-8-L8-2026-10-18/books/l8-rework-2.md:71` 明确 keep driver gate rows on both backends，故未列为重复，交 lead 按 79-4 判断。
6. 共享夹具的手写种子（tests/work-graph/R3d-fixture.ts:85-91 的 encodeProjectSnapshot/encodeWorkspaceSnapshot + commit，tests/helpers/task-claim-fixture.ts 的 trusted scope）不在本区 78 个文件内但被本区使用；公开步骤（projects/create + workspaces/register）存在，是否本轮改由 lead 定。
7. Stage-1 “EXPECTED RED”文字（host-settings:9、settings-ui:2-9、goal-conversation-start:21,121、session-rendering:520）对应实现已存在且测试为绿；这是注释/命名陈旧，不是行为陈旧，按“不报 style/naming”未列条目。
8. RL-40-43 与 A2-settings 的“无该字段的旧设置文件”未按 79-1 报 stale：PersistedSettingsV1 的 automation/resourceCaps 是当前可缺省字段（src/app/host-settings.ts:294,503,564；host-settings-types.ts:35,42），生产明确 absent stays absent，不是旧版本解码分支。
