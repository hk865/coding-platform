# P6 补跑只读诊断（第二轮）

- **运行：** `g6-2026-11-25-d6642f43`，2026-11-25T01:40:19Z–03:51:57Z；八个主场景 + E08b。
- **树：** 当前目录，HEAD `06a7bd11`（平台 `85f0b065` + 驱动四个提交）；`7dp6dg2-base` = `06a7bd11`，本轮无代码改动、无提交、未起 Host、未调模型。
- **报告结果：** total=8：pass 1（iteration）、fail 4（E05、E06、E08、waiting）、uncovered 3（E09、E12、intervention）；E08b pass。
- **诊断修正：** E06 的报告 fail 挂在 `handoff` 上，是驱动假超时；`handoff` 应 pass，但 E06 仍应是 **fail**，fail 的判据应落在 `successor-input`/`history-continuity`（平台：简报未消费）。E05 的 `reviewer`/`name-different`/`name-same` 与 `line-choice` 也是驱动的假 `entry-missing`，修驱动后应 pass/not-run。E05 仍 fail（overlap 平台、duplicates/temporary 模型），E08 fail（模型），waiting fail（expiry-once 驱动误判 + 平台续作缺口）。
- **口径：** **平台** = `src/` 的行为不符合 `docs-now` 的规格或决定；**驱动** = `scripts/acceptance/` 判错、等错或发错；**模型** = 平台和驱动都照规矩，模型该做没做（含提示词/skill 缺口）。未走到的支路记 `uncovered`，不当 fail；`entry-missing` 只在公开入口确实缺失时用，不把“驱动没读”记成缺入口。
- **P6 观察点：** `.dsh-ref/n1118/design-frozen.md:833-840`（E08、E09、直接干预、等待；没走到的支路记未覆盖）。
- **证据：** 八个场景账本/内核库/工件库的只读副本（`python3` 的 `sqlite3`，`mode=ro&immutable=1`）、`checks/http.jsonl` 行号、`checks/model-calls.jsonl`、`checks/notes.md`、代码/规格 `文件:行`。各子任务的详细报告在 `.dsh-scratch/p6d2/{e05,e06,e08,wait,e09e12int}/report.md`（本轮产物只在 `./.dsh-ref/out/`；scratch 不交付）。
- **本轮纠正的报告口径：** `README.md` 的“31 个叫醒轮”“E06 12 轮/177 次调用”是跨 unit 重复计数；真实 25 轮、E06 6 轮/98 次调用。多处“the platform did not do it”是驱动的固定超时措辞，不是平台归因。

## 总表

> 一行一个根因；同一根因下的多条判据合在一行。`结果` 按报告原 verdict 写，括号里写应然的 verdict。未单列的 pass/未覆盖见各节。

| # | 场景 | 判据 | C 行 | 结果 | 类别 | 一句话根因 | 关键证据 | 建议改法 | 谁改 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | E05 | overlap | C-182/183/217 | fail | **平台** | 整个 E05 只有一条 local-workbench 执行线，两个无依赖任务同 Session 串行；同模块门是规格 B19 的正确行为 | t-users `TaskClaimed` 01:42:01.824、`ExecutionEntryEntered` 01:42:02.596、Run `3296b1b5` 01:42:02.594–01:42:45.317；t-orders `TaskClaimed` 01:42:45.393、Run `1dd97541` 01:42:46.668–01:43:13.705；两次 claim 的 `sessionRef` 都是 `session-128…`；t-orders 的 `ModuleOverlapGateOpened` 在 01:42:01.891（距 claim 67 ms、距 entered 705 ms）；`role-lines.ts:198-200`；`session-chooser.ts:50-60,465-467`；`workflow.ts:2592-2594,2862,3046-3056` | **claim 即占线**：`TaskClaimed` 提交时就把线标 occupied（或选择器把“有未结束 claim 的线”按 occupied 排除），不能只判 `occupancy`——claim→entered 之间 772 ms，第二次选择正落在这段里；全占时走 `suggestStep`/`host_pick_member`（B19、`MVP-BEHAVIOR.md:366/392`）；测试加在 `tests/business/S7C-L1-pick.test.ts` / `S7C1-P-suggest.test.ts`：一条执行线、两个无依赖任务，第一个刚 claim、还没 entered 时，第二个必须开建成员建议/请求 | 平台（lead 排） |
| 2 | E05 | duplicates | C-208 | fail | **模型** | Work Run 0 次 `project_source`；模型用 read/shell 看见副本，但没产出 `duplicates:true` 的候选 | 内核库 `grep -c project_source` → 0；工具在 `project-source-tool.ts:48,218-232`；`e05.mjs:252-263` | 执行者 skill/输入补“报重复必须调 `project_source compare`（`duplicates:true`），以 candidates 两处 path:line 为准；读文件不算报告” | 模型/skill |
| 3 | E05 | temporary | C-208 | fail | **模型** | `test/rules.test.js` 是 t-users 自己 `edit create` 写的，计划只列 `test/users.test.js`，留到结束仍未跟踪 | 内核库 pos 69（01:42:19.036，首次因 schema 失败）、pos 76（01:42:23.790，成功）；`e05.mjs:295` 的 planned 不含它 | 执行者 skill/输入写“只改 plannedFiles；新增测试要么先请计划补列，要么结束前删除” | 模型/skill |
| 4 | E05 | reviewer / name-different / name-same | C-208/218 | uncovered (entry-missing)（应 pass） | **驱动** | `e05.mjs:269` 把 `NodeCard.evidence` 数组当单个对象，`evidence?.source` 永远 undefined；轮 `bbd713c9` 的 Evidence 是可读的 | 轮 rev4 `evidenceRefs=[64ab5760…, b659822c…]`；Evidence `b659822c` 01:47:25.892 `outcome=PASS`；驱动 01:47:34.072/.076 读 `verification/round`、01:47:34.080 读 `graph/look`（`http.jsonl:138-140`），不是读得太早；`graph-context-contracts.ts:80-81` 写数组 | `e05.mjs:269` 改 `findAll(look, n => n.source?.checkId === null && typeof n.outcome === 'string' && typeof n.evidenceId === 'string')[0]` 或 flatten `node.evidence`；修后三条应 pass | 驱动 |
| 5 | E05 | line-choice | C-73/191 | uncovered (entry-missing) | **驱动** | `e05.mjs:300` 无条件记 entry-missing，全程 0 次 `workflow/driver-read`；平台 `last.pick` 有 `rank/candidates/incomplete`，只是不另存候选线清单 | `e05.mjs:300`；E05 段 `grep -c 'workflow/driver-read'` → 0；`collaboration-driver.ts:73-83`、`business/workflow/contracts.ts:317-324`、`contracts/pick-basis.ts:5-12`、`core-routes.ts:745,1872`；`MVP-BEHAVIOR.md:350`“不另存” | 读 `started.value.last.pick`（或 `driver-read` 的 `last.pick`），断言 `rank` 六键、`candidates`、`incomplete`；候选线清单按 `MVP-BEHAVIOR.md:350` 记 not-run，不记 entry-missing；不新增读口 | 驱动 |
| 6 | E06 | handoff（fail 挂错判据；E06 仍 fail） | C-219 | fail（应 pass） | **驱动** | 模型调用了 `hand_off`，接任线出现了；驱动只在 `lines/list` 的 `chainSessions` 找前任，而 handoff 的 provenance 不是 continuation，永远不进 chainSessions | `SessionHandoffRecorded` #550 01:49:54.168（trigger=tool，caller Run 2adca42c）；`SessionCreated` #556 01:49:54.457（provenance.kind=handoff）；`HandoffBriefRecorded` #560；接任 Run `5632f938` 01:49:54.538；`e06.mjs:118-119`；`work-line-reader.ts:825`；`contracts/work-line.ts:61`、`line-status.ts:443` 的 `handoff_from` | 用 `lines/list` 的 `status.markers.handoff_from`（或 Session provenance `kind==='handoff'`）认接任线；`chainSessions` 只用于 continuation；驱动回放测试。E06 的 fail 仍成立，但应落在平台 `successor-input`/`history-continuity`，不是 `handoff` | 驱动 |
| 7 | E06 | same-task-new-run / hand-or-drop | C-135/223 | uncovered (not-run) | **平台** | 交接 brief 的 tasks 是 `t-len-limit`，但接任线只领到 `t-long-email-tests`；源 Session 对 t-len-limit 的 `SessionWorkLink` 仍 `until=null`，源线继续领 t-len-limit 并撞 `no_new_basis` | `HandoffBrief` tasks t-len-limit；接任 Session f6cea4a3 的 link 只有 t-long-email-tests；源 Session 128bdfaa 的 t-len-limit link until=null；原线 Run 2adca42c/23377e07/2ffd99d6 连续领 t-len-limit；`CoreOperation session-handoff-3ca73e…` rev9 phase=running/stage=transfer/receipt=null；`session-responsibility.ts:47`；`session-handoff-service.ts:1390-1400,1425-1440,1021-1028`；`workflow/session-handoff.ts:136-148` | stage=transfer 在源 Run 结束后重读责任记录、重算 pin 再提交，不在 `revision_conflict` 后静默停；测试 `WP1-continuation-handover.test.ts:86`、`S6B2-handoff-brief.test.ts:121`、`S7B-V-restart.test.ts:56` | 平台 |
| 8 | E06 | successor-input / successor-frontier / no-restatement / excluded-path / history-continuity / restart-paused / archive / wake | C-75/135/106/194/149/151/68/181/209/223 | uncovered (not-run)（修驱动后 fail） | **驱动（中止）/ 平台（若跑到）** | 驱动停在 handoff 假 fail；接任 Run 5632f938 在、brief 写了但 `consumedBy=null`；successor-input/history-continuity 若跑到会因简报未消费而平台 fail，E06 的 fail 应落在这两条；no-restatement/archive 若跑到应 pass，wake 若跑到应 pass，restart-paused 不适用 | successor Run 5632f938 01:49:54.538；HandoffBrief `consumedBy:null`、tasks t-len-limit；源线 link until=null；notes:52-58 | 修 handoff 检测后重跑；平台先修 transfer；不要因 handoff 误判改 successor-frontier 的 entry-missing | 驱动 + 平台 |
| 9 | E06 | 177 次调用 / 12 个叫醒轮 | 记账 | — | **驱动** | E06 自身 98 次 `model.request_started`、61 条计费请求（55 query + 6 run）、6 个叫醒轮；README 的 177/12 把 E05 的 79/6 重复算进 E06；总 31 应为 25 | `model-calls.jsonl` E05 59/E06 61、requestId 交集 0；共享账本 12 个 `intervention-planning-`（E05 6 + E06 6）；`e06.mjs:57-67`、`run.mjs:200-230`、`report.mjs:82-86` | `collectToolWalls` 按 `submittedAt >= rec.facts.startedAt` 过滤，或 `p6Count` 全局去重；报告把 31 改 25、E06 12 改 6 | 驱动 |
| 10 | E08 | versions | C-210 | fail | **模型（主）/ 驱动（判语）** | `every_step` 改需求轮只有 `submit_secretary_answer`（没有 `submit_plan_round`，按自治档设计）；模型交 `ideas: []` + 正文“改法已交候选”，0 次 `submit_plan_round`，没有候选；30 分钟超时 | 改需求 QueryJob `1be515c7` 02:31:14.307 提交、02:31:25.774 answered；`submit_plan_round` 0 次；`PlanProposalRecorded` 1 条、`PlanRevisionAccepted` 1 条；`plans/request-candidate` `http.jsonl:324` repeat 191（02:31:32–03:01:34）；`query-preparation.ts:516-523`；`skill-platform-secretary.txt:14-15`；`submit_secretary_answer` schema 的 `ideas` | skill/输入补“改目标先交 2–3 个方案；`ideas: []` 不开规划续轮；没看到采用回执不说已交候选”；判语从“the platform did not do it”改成“模型没交候选”；E08 仍按 lead 判 fail（`driver-build-reply.md:12-13`） | 模型/skill；驱动 note |
| 11 | E08 | hold-before-adopt | C-210 | uncovered (not-run) | **模型（暂缓已放）/ 驱动记法** | 秘书其实在 02:31:20.229 放了 `hold_claim`（agent/secretary、held、t-len-limit 的 t1-sub、sub 0 Run）；驱动候选等待先超时，没执行到这条，not-run 正确 | `TaskClaimHold` 快照 `t1-sub` state=held、placedBy agent/secretary、placedAt 02:31:20.229；sub 0 Run；`e08.mjs:239,243-260` | 报告 note 补“暂缓已放、sub 0 Run”；**不要**改 fail；不改判据 | 驱动 note |
| 12 | E08 | switch / old-evidence / required-cancel / autonomy-later | C-210/126 | uncovered (not-run) | **模型** | 没有候选、没有采用版、没有 div 任务；switch/old-evidence/required-cancel 走不到；草稿本来 every_step，autonomy-later 没改档 | `PlanRevisionAccepted` 仅初始 1 条；无 div；`e08.mjs:183-184,286,291-335` | 修候选问题后重跑 | 模型 |
| 13 | E08 / E08b | P6F 第 4 条“出路” | — | 未触发 | — | 本轮 E08 0 次 `submit_plan_round`，E08b 3 次但两次是 schema/检查冲突、一次 accepted，没有一次“无 active required carrier”的出路拒绝；代码在 `plan-validation.ts:835-841`（P6F `541e542d`/`7eaeb8ee`） | kernel E08 0/E08b 3；E08b 拒绝原文；`plan-validation.ts:835-841` | 另跑一次“模型已交 `submit_plan_round`、且取消唯一载体”的轮，才能验证出路；本轮只能说“没被触发”，不能说“有效/无效” | lead/驱动 |
| 14 | E08b | sub-running / stop-delivered / safe-point-end / adopt-after-end | C-210 | pass | — | 模型这次交了 `submit_plan_round`（第 3 次 accepted）；stop 03:51:08.429 释放，sub Run 03:51:30.501 completed，采用 03:51:55.842，busy 0，采用版 `t1 active→cancelled`、setIn 该版本、actor human/g6-person | `PlanProposalRecorded` 03:51:52.752；`PlanRevisionAccepted` 03:51:55.842；`http.jsonl:772,779,798`；`ActionRequest stop:a144…`；disposition snapshot | 不改；写清“Run 是自己收到叫停后收尾，不是平台标 cancelled”；`#7` busy 本轮 0 次、未验 | — |
| 15 | E08b | 采用版 o1/o2 矛盾 | C-210 | 未覆盖/待 lead | **平台/规格（待定）** | 采用版 `initial-plan-8fd…` 的 o1（required，taskIds t1/t2/g1）仍要求 sub 的验收（`test/sub.test.js`、sub 与 mul 测试全过），o2 又写“calc.js 不含 sub”；旧检查 `syntax-and-files` 仍要求 `test/sub.test.js`；t1 已 cancelled、g1 superseded | `PlanRevision` 快照 o1/o2；`TaskRequeue` 03:51:32.344 `checkId syntax-and-files` FAIL；`plan-validation.ts:835-841` 只查 active required carrier，不要求旧验收随取消退休 | lead 裁定：平台应拒绝/退休旧 required 验收，还是规格允许旧 gate superseded 后不再评估；裁定前不推翻 E08b 四条 pass | lead |
| 16 | E09 | person-decides / new-version | C-211/62/55 | uncovered (not-run) | **模型** | 执行者把“要人定的契约”走成 `ask_copy`（其工具集没有 `ask_person`；skill 说“要人定的事交参谋”；`ask_copy` 说“不代替上报、问人”）；副本答、不出卡，人没答卡，新版本没发生 | 执行者 Run `d56c903d` 工具集无 `ask_person`；消息 `session-message-a7d8e3f0…` `answeredBy:copy`；`line-ask.ts:72`；`consultation.ts:358-360`；`skill-platform-work.txt:45`；`ask_copy.json:2`；E09 无 `plans/apply`/`messages/send` | 执行者改走 `send_session_message`（needsReply）把冲突上报参谋线，参谋线 `ask_person` 出卡；不是平台把 `ask_person` 路由成副本 | 模型/skill |
| 17 | E09 | report-after-dispatch / diagnosis-reverify / uncovered-round | C-185/211/99 | uncovered (not-run) | — | 同目标没有 applied 派活；3 个检查轮没有以消息为依据的重验；没有 INCONCLUSIVE 轮；not-run 正确 | 首版 plan 1 条、TaskClaimed 3 条；reverify null；rounds PASS | 不改 | — |
| 18 | E09 | gate-contract-conflict 检查太弱 | —（计划检查） | pass（检查质量） | **模型/计划** | 副本 03:06:51 明确答“未收到用户答复”，但检查只 `grep parseDate src/api.js && grep import… src/report.js`，不校验返回形态，03:07:28 PASS，03:07:38 Goal COMPLETED | `VerificationRoundFinalized` 的 `configuration.checks`；03:07:28 PASS、03:07:38 COMPLETED | 模型把 parseDate 返回值契约写进检查（断言 Date 对象/字段形态），不是平台检查器或驱动判据问题 | 模型/skill |
| 19 | E12 | history-reuse | C-220 | uncovered (not-run) | **模型** | 新 Goal 的 Run 没有一次成功工具结果引用旧 Goal/旧 Run；`look_graph`/`find_graph`/`read` 都在，旧 Goal 可读；按定义 not-run | t2 Run `d4a3f4da…` 03:11:03–03:11:30 的 tools 含 `look_graph`/`find_graph`/`read`；`QueryJobAnswered.sources` 只有新 Goal/workspace；`e12.mjs:152` | 模型在启动新工作前用 `look_graph` 读旧 Goal，让结果带 `goal` source；不改平台 | 模型/skill |
| 20 | E12 | stale-premise / wait-registry | C-220/207 | uncovered (entry-missing) | — | `stale-premise` 是模型对已查事实的取舍，公开读口没有逐项字段；`wait-registry` 行为在（`goal-wait-wakes.ts:199-246` 启动只读重建），没有公开读口，E12 本身 0 个 `waitAfterSend`；lead 已接受 entry-missing | `e12.mjs:154`；`goal-wait-wakes.ts:199-246,373,422-428`；`host.ts:1192-1197,1452-1454`；`STATE-MACHINES-SPEC.md:3697-3711,5782`；`STATUS.md:446`；E12 `waitAfterSend` 0 次；`7d2-g6b-reply.md:157,259` | 不补读口；E12 严格说两条都是 not-run，不是平台缺陷 | — |
| 21 | intervention | planning-when-idle / claim-once | C-199/200 | uncovered (not-run) | **驱动** | 长目标期间有 95 秒、39 秒空档；驱动的 idle watcher 03:23:55 才第一次读 `lines/list`/`sessions/facts`，长目标 03:23:52 已 COMPLETED，两个分支在目标结束后才打开 | Run 结束/开始：t1 03:19:30.460 → t-slugify 03:21:05.891（95 s）；t-slugify 03:21:34.745 → t-truncate 03:21:42；t-truncate 03:22:13.597 → t-capitalize 03:22:20；`http.jsonl:656-662` 03:23:55；`GoalCompleted` 03:23:52.402；`int.mjs:250,257,263` | 把 idle/claim watcher 提到 `driver-start` 后、pause 的 `sleep(60s)` 之前（或独立轮询），在第一个 95 秒空档发分支；不要等 Goal 完成后才判 not-run | 驱动 |
| 22 | intervention | four-endings | C-201/202/203 | uncovered (entry-missing) | — | “反问/非法”不能由驱动的公开入口造出；lead 已接受 entry-missing；这次 int 的 idle 分支没走。waiting 的 609010/0b41 两轮实际出了 `needs_decision`+questions（反问形状），可作旁证 | `int.mjs:355`；`7d2-g6b-reply.md:157`；waiting QueryJobAnswer `needs_decision` | 不改判据；可选把 waiting 两轮写进证据，跨场景需 lead 同意 | — |
| 23 | intervention | review-packet | C-199 | uncovered (not-run) | — | 2 条直接干预被 Run 接受；没有审阅线、这个目标 0 个 `execreview` 包；计划检查里没有审阅项，平台不会自己起审阅线；P6F #4/lead 第 5 条“只看消费干预的 Run 所在任务”已照做 | int 的 `SessionCreated` 6 条无 reviewer；`QueryJobSubmitted` 无 `execreview`；`int.mjs:370-403` 按 taskRef+subjectRunRef 对 | 按 Q7 不改 REQUEST；not-run 正确；下一轮要覆盖需 lead 同意加审阅项/线 | — |
| 24 | intervention | completed-goal | C-114 | uncovered (not-run) | — | 完成旧 Goal 的线 `session-ae99…` 被长目标复用，`latestWork` 已是 `456148…/t-*`；消息按 `intervention.ts:195` 指向当前 Goal，不会成为旧 Goal 的新目标请求；驱动按 lead 第 6 条挑 `latestWork.task.goalId === done.goalRef.goalId`，挑不到 not-run | `doneWorkers` 只有 session-ae99；`sessions/facts.latestWork` 已是新 Goal；`int.mjs:420-424`；新 Goal 456148 03:20:01 创建 | 挑线逻辑符合裁定；可选在长 Goal 提交前先测旧线，或带 `goalRef: done.goalRef`（后者无书面例子，需 lead） | — |
| 25 | waiting | expiry-once | C-171/190 | fail（应 not-run） | **驱动** | 驱动盯的是 9f9f，但 9f9f 03:26:11.333 已被秘书答复（`expiredAt=null`、无 `acceptedInputs`），永远不会到期；`wait.mjs:324-326` 的谓词只看 `expiredAt`/`acceptedInputs`，不看 `response`，20 分钟超时被 `broken()` 记成“平台没做” | 9f9f snapshot rev2 `status=responded`、`response.respondedAt=03:26:11.333`、`expiredAt=null`；`http.jsonl:742` `messages/read` repeat 129、digest 未变（03:28:54–03:49:00）；`wait.mjs:324-326`；`flows.mjs:44-53,232-246`；平台实际到期 45b238 03:31:42.117，03:31:42.454 wait_reply 领取，03:31:51.591 `consumesWait:true`（`STATE-MACHINES-SPEC.md:3650`） | `wait.mjs:324-326` 谓词加 `|| value?.response != null`，让 `:328` 的 not-run 分支生效；改盯当前等待（45b238/续作），不要只盯 9f9f；`consumes`/`late-reply` 也改用当前等待/“到期被消费后”为迟回起点 | 驱动 |
| 26 | waiting | restart-kept | C-170/207 | uncovered (not-run) | **平台（主）+ 驱动（次）** | 原等待记录保留（同 messageRef/收信人/期限），但没有任何 Run 消费：重启是 crash 后的普通 requeue（不是 wait_reply 续作），新 continuation Session 读不到旧 Session 发的等待；`readContinuation` 只看紧邻上一条 yielded Run | 9f9f snapshot `expiredAt=null`、无 acceptedInputs；event #213 73442e11 crashed、#217 requeue、#219 新 Session 5e2aeefc；kernel `tool.failed forbidden: this message is not addressed to or sent by the caller Session`（`mailbox-access.ts:101`）；`workflow.ts:1548-1562`；驱动 `run.mjs:318-340` 关 Host 时 Run 还活着 | 平台：接续/重排队带上“这条任务上一条 yielded 等待的 wait_reply 基”（或把已保存回复作为下一轮输入）；允许 continuation Session 读 `provenance.from` 发的等待；测试 `S7B-V-wait-kept.test.ts:30`、`S7B1-B-continuation.test.ts:51/153`、`S7B-V-restart.test.ts:56`。驱动：插话后等 Run 结束再关，或把“Run 仍活着就关”记 interrupted、restart-kept 记 not-run；重启后重解析成员线 | 平台 + 驱动 |
| 27 | waiting | second-expiry | C-171/190/224 | uncovered (not-run) | **平台（因）+ 模型（次）** | 旧根因 `messageRefOf` 已修；这次链只有 `[9f9f]`，模型重问的 45b238 `followupOf=null`，不是追问链；9f9f 也没到期 | `flows.mjs:1118-1128`、`wait.mjs:154-160`；45b238 snapshot `followupOf=null`、deadline 03:31:06、expiredAt 03:31:42；events #233 | 平台先修 reply 到续作；模型重问必须带 `followupOf=原消息` | 平台 + 模型/skill |
| 28 | waiting | consumes / late-reply | C-187/224/189 | uncovered (not-run) | **驱动** | `consumes` 拿 9f9f（acceptedInputs 空）判恰好一次消费，必 fail；`lateSaved` 以 `expiredAt` 为界，会把 45b238“到期后、消费前”的正式回复当迟回并因 `responseConsumed=true` 判 fail，违反 `STATE-MACHINES-SPEC.md:3650` | `wait.mjs:369-371`；`wait.mjs:91-92,134,375-378`；45b238 acceptedInputs `part=response, consumesWait:true` 03:31:51.591；45b238 response 03:31:42.304 | 用“当前这条等待”判 consumes；迟回起点改为“有 expiry 接受/到期已被消费之后”；没有接受时先分辨 not-run/平台没送 | 驱动 |
| 29 | waiting | reply-first / transfer / disconnect | C-187/224/195/196 | uncovered (not-run) | **驱动（主）+ 模型（次）** | 第二问其实已发出：a0f8（03:31:51.526，期限 04:01:51.526）与补发 1452（03:32:04.373，期限 04:02:04.373），停下时都 open；驱动的 `member` 只在 `wait.mjs:219` 解析一次旧 Session，`memberSends`/`waitsOf` 看不到 5e2aeefc 发的两条 | a0f8/1452 snapshot open、无 response/expiredAt；events #233/#258/#260/#272/#273；`wait.mjs:219,387-390,423-437,449-451`；a0f8 的 Run 1b29ca00 因 `waitAfterSend` 同组两个 read 被判 `tool_group_yield_unsettled` crashed | 驱动重启后把成员线重解析到 continuation Session；模型/skill：`waitAfterSend:true` 轮里只发这一条，同组不放别的调用（Kernel 冻结行为） | 驱动 + 模型/skill |
| 30 | waiting | supply-order | C-172/192/184 | uncovered (not-run) | **驱动** | `wait.mjs:442` 无条件记 entry-missing，从不尝试；精确的“供给顺序”没有公开逐项读口，turn 输入只能作旁证 | `wait.mjs:442`；续作 turn `## 已接受的输入` 顺序（92bac 人消息在前、39c1 通知在后） | 至少把 turn 输入顺序抄进 note；不新增读口（无书面逐项读口） | 驱动（可选） |
| 31 | 记账 | 31 个叫醒轮 / 只回“收到”1 个 / T6 | 取舍 T6 | 信息 | **驱动（记账）** | 真实 25 个 distinct `intervention-planning-` QueryJob，不是 31；差 6 全在 E06（重扫 E05 同项目）；25 轮里 0 条“叫醒轮回信再叫醒对方”的边，最长严格交替 1 轮，同对线最多 3 轮且同向；唯一 ack-only 是 waiting d56f，实际是事实问答 | 八本账 `COUNT(DISTINCT aggregateId)`：e05 12、e08 1、e08b 2、e09 1、e12 1、int 3、iter 1、wait 4 = 25；`e06.mjs:57-67`、`run.mjs:214-220`、`report.mjs:82-86`；`wake.json` 的 `srcmsg`/`sent` 0 条边；`design-frozen.md:876` | 按 `submittedAt` 过滤/全局去重，把 31 改 25；ack-only 排除 final/response；**不加叫醒链深度上限**（T6 不触发） | 驱动 |

## 旧根因：第一轮已修 / 未复现

- **E05 `pick-suggest` 死锁（平台）：已修。** 第一轮建线建议信进了没有 `create_member` 的冷启动轮，记 delivered 后不再开轮，空等 32 分钟；这次 E05 目标 01:42:01.428 创建、01:47:26.718 COMPLETED（events #165/#452），全程 5 分 25 秒，没有 `pick-suggest:…g6-e05…` 事件。P6F F1 生效。
- **E06 因 E05 无项目而 Abort（连带）：已修。** E06 这次跑了 42 分钟、6 个结束的 Run；hand_off 真的被调用、接任线真的建出（§E06）。
- **iteration `.workbench` 检查环境（平台）：已修。** iteration pass 10/10（`README.md:16`）。
- **E09 `observation-after-pass`（平台）：已修。** 第一轮 `test/` 尾斜杠让 8 次 capture 全失败；本轮 7 次 `ArchitectureAutoCaptureRequested` 都换新 `captureId`（`985841a4`→`6f6c1bcc`→…→`d0b7b974`），catalog paths 是 `src/api.js`/`src/report.js`。P6F F3 生效。
- **E09 `adviser-explains`（驱动）：已修。** 第一轮 `turnsByDuty` 快照早于 final；本轮 `e09.mjs:197` 走副本回答，03:06:51 的答复同时点到两文件，pass。
- **E09 `executor-reports`（驱动）：已修。** 第一轮按 `args.intent` 认上报恒 undefined；本轮按 `send_session_message`/`ask_copy` + `messageView` 认，pass。
- **intervention `paused-queues`（驱动）：已修。** 第一轮 pause 发在 Goal COMPLETED 后 5 秒被拒；本轮 pause 03:22:20 在 RUNNING 时 committed，暂停中 offerable，resume 后 delivered，pass。
- **waiting `second-expiry` 的 `messageRefOf`（驱动）：已修。** 第一轮 `chainRefs=[647b,647b]`；本轮 `flows.mjs:1118-1128` 先取本条 `message.ref`、排除 `followupOf`，`wait.mjs:154-160` 按 messageId 去重，链是 `[9f9f]`。这次的 not-run 是链本身没接上，不是重复。
- **E08b `adopt-after-end`（模型/驱动）：已修/这次成立。** 第一轮模型只交 prose、30 分钟超时、`adopt-after-end` 误判 fail；本轮模型 3 次 `submit_plan_round` 第 3 次 accepted，stop 03:51:08、Run 03:51:30 completed、采用 03:51:55、busy 0，四条 pass。驱动“没候选记 not-run”的修正本轮没被触发。

## E05

### 时间线与事实

- 01:40:21 打开工作区；01:40:24 提交 seed 冷启动；01:41:02 confirm/adopt；01:41:54 seed Goal COMPLETED。
- 01:42:01 `completion-policies/install/activate`、`role-lines/open reviewer`；01:42:01.428 E05 目标 `g6-e05-mwvgkdze-7` 创建；01:42:01.525/756 计划记录/采用；01:42:01.787/873/990 三次 `workflow/driver-start`（t-users、t-orders、整目标）。
- 01:42:01.824 t-users `TaskClaimed`（Run `3296b1b5…`，Session `session-128…`）；01:42:01.891/02.738 同模块门打开（waiting t-orders、running t-users）。
- 01:42:02.594 t-users Run 开始；01:42:45.317 结束；01:42:45.393 t-orders `TaskClaimed`（仍是 `session-128…`，比 t-users 结束晚 76 ms）；01:42:46.668 t-orders Run 开始；01:43:13.705 结束。
- 01:42:46.846 t-users 轮 `7cb7e4e6` open；01:43:59.982 审阅 Evidence `0c57cf36` FAIL；01:44:00.049 finalize INCONCLUSIVE；01:44:00.147 `VerificationRoundReverified` 新轮 `bbd713c9`。
- 01:43:13.973 t-orders 轮 `5bba1ecb`；01:45:18.103 审阅 Evidence `6a13df6b` PASS；01:45:18.197 `TaskCompleted t-orders`。
- 01:47:25.892 重验轮 `bbd713c9` 的审阅 Evidence `b659822c` PASS；01:47:25.963 finalize PASS；01:47:26.011 `TaskCompleted t-users`；01:47:26.718 `GoalCompleted`。
- 01:47:33.585–01:47:34.515 驱动读 display/queue/executions、files/compare、tasks/query、executions/history、verification/round×2、graph/look、goals/read、lines/list、sessions/*（`http.jsonl:130-154`）。

### 逐条

**overlap（平台，fail）。** 计划 `g6-e05…-plan` rev1 的两个任务 `executionDag.dependsOn=[]`、scope 都是 `src-entities`；`src-entities` 的 paths 是 `src/users.js, src/orders.js`，`src-rules` 是 `src/rules.js`。整个 E05 只有一条 local-workbench 执行线：两次 `TaskClaimed` 的 `claim.sessionRef` 都是 `session-128bdfaa…`；第二条 local-workbench `session-f6cea4…` 01:49:54 才创建（E06 的 handoff）。门按规格（目标、任务、模块）打开，等 t-orders、在跑 t-users（events #169/#177），01:42:43.561 秘书模块注记已满足；门没有永久串行化。真正的问题是平台没有为两个无依赖任务提供第二条执行线：`session-chooser.ts:50-60` 的 `roleVerdict` 只把 `occupancy !== null` 当 occupied，`roleReusable` 只接受 ok，`session-chooser.ts:465-467` 只在 `ranked.length===0` 时 create，`workflow.ts:2862` 只在 `chosen.kind==='create'` 时返回 no_line 再走 `suggestStep`（B19 的建成员建议），否则 `lineBusyWait`。**时序关键**：t-users `TaskClaimed` 01:42:01.824，`ExecutionEntryEntered` 01:42:02.596（差 772 ms）；t-orders 的第二道门 01:42:01.891，正落在 claim→entered 之间，此时 `occupancy` 还是 null，所以“把有在跑 Run 的线按 occupied 排除”抓不到这段。结果 t-orders 等 t-users 空出来才 claim。`role-lines.ts:198-200` 的公开 `role-lines/open` 只有 secretary/adviser/scribe/reviewer，没有 executor，驱动也开不了第二条。最小改法：**claim 即占线**（`TaskClaimed` 提交时把线标 occupied，或选择器把“有未结束 claim 的线”按 occupied 排除），全占时走 `suggestStep`/`host_pick_member`；测试加在 `tests/business/S7C-L1-pick.test.ts` / `S7C1-P-suggest.test.ts`（一条执行线、两个无依赖任务，第一个刚 claim、还没 entered 时，第二个必须开建成员建议/请求，不能排同一条线）。

**duplicates（模型，fail）。** 驱动只数 Work Run 的 turn：`e05.mjs:249-253` 取 t-users/t-orders 的 `runHistory`，`compares` 只留 `result.name==='project_source'` 且 args 含 `"duplicates":true` 的成功结果。内核库 `grep -c project_source` → 0；t-users/t-orders 用 read/shell/edit。平台能力在：`project-source-tool.ts:48` 的 compare 分支支持 `duplicates?: true`，`:218-232` 转给 `compareWorkspace`；tool-specs 工件 `1a517f10…` 含 `project_source`。秘书线 01:43:21 的 `run_readonly_command` 看过 `contact-check.js`/`is-email.js`，但那不是 Work Run 的 `project_source` 结果。planted 文件在 E05 时真的重复（审阅 body 明说 `src/rules.js` 当时只有 `EMAIL_PATTERN`+`isEmail`，`contact-check.js` 的 `looksLikeMailAddress` 是同一条规则）；当前 `src/rules.js` 已被 E06 改（01:49:16 加了 `MAX_EMAIL_LENGTH`），不能拿当前文件反推 E05。模型/skill 缺口：执行者 skill 没写“查重复定义要调 `project_source compare duplicates:true`”。

**temporary（模型，fail）。** 内核库 pos 69（01:42:19.036）模型 `edit` create `test/rules.test.js`，因 `expectedRevision` 不被 schema 接受报错；pos 76（01:42:23.790）重试成功，内容 3 个 `isEmail` 用例。t-users 计划 `plannedFiles=['src/users.js','src/rules.js','test/users.test.js']`，`test/rules.test.js` 不在任何计划里；E05 不提交，文件一直 `??`。`e05.mjs:295` 的 planned 不含它，`e05.mjs:297-299` 记 fail。执行者输入把 plannedFiles 说成“只是提示，不是限制”，与验收口径冲突，是诱因。模型 skill 应写“只改 plannedFiles；新增测试要么先请计划补列，要么结束前删除”。

**reviewer / name-different / name-same（驱动，应 pass）。** `e05.mjs:264` 取最后一个带 reviewer 要求的轮 → `bbd713c9`；`reviewState=pass`；01:47:34.080 读 `graph/look`（`http.jsonl:140`），在 Evidence 01:47:25.892 和 finalize 01:47:25.963 之后，不是读得太早。轮 rev4 `evidenceRefs=[64ab5760…, b659822c…]`；`b659822c` `kind=verdict`、`outcome=PASS`、`source.checkId=null`，覆盖 `o-review/r-review`；`0c57cf36`（FAIL）挂在旧轮 `7cb7e4e6`，`6a13df6b`（PASS）挂在 t-orders 轮，驱动没取错。契约 `graph-context-contracts.ts:80-81` 写 `evidence?: EvidenceV1[]`，`graph-context-reader.ts:1401-1404,1426` 填数组；`e05.mjs:269` 的 `node.evidence?.source?.checkId` 对数组取 `.source` 永远 undefined，`findAll(...)[0]` 永远空。修好后 `reviewer` PASS；`name-different` 的 body 明写“同一条规则写了两份（异名）：`src/legacy/contact-check.js` 的 looksLikeMailAddress…”（SAME_RULE）；`name-same` 的 body 明写“名字相同但规则不同：`src/legacy/is-email.js`…按审阅口径不算重复”（NOT_SAME）。最小修法：`e05.mjs:269` 改 `findAll(look, n => n.source?.checkId === null && typeof n.outcome === 'string' && typeof n.evidenceId === 'string')[0] ?? null`，或 flatten `node.evidence` 后再 filter。

**line-choice（驱动，entry-missing）。** `e05.mjs:300` 是无条件 `uncover('line-choice','entry-missing',…)`；E05 段 `grep -c 'workflow/driver-read'` → 0，三次 `driver-start` 的返回值只用 `status/state`，把 `last` 丢了。平台公开读口：`driver-start`/`driver-read` 返回 `CollaborationSnapshot.last`（`collaboration-driver.ts:73-83`、`core-routes.ts:745,1872`），`WorkflowAdvanceResult.value.pick: PickBasisV1`（`business/workflow/contracts.ts:317-324`），`PickBasisV1={rank,incomplete,candidates}`（`contracts/pick-basis.ts:5-12`）；`rank` 是六键里决定这次选择的那一键。公开读口不给“候选线清单/逐键比较”，`MVP-BEHAVIOR.md:350` 明说“比较结果随推进返回（`PickBasisV1.rank`），不另存”。所以驱动该读 `last.pick`，或者按 MVP:350 记 not-run，不要记 entry-missing；不要新增读口。

### 否定证据

- E05 段 HTTP 154 行（`grep -c '"scenario":"E05"' checks/http.jsonl` → 154）；`overlap-release` 0 行；`workflow/driver-read` 0 行；账本 `ModuleOverlapGateReleased` 0 条；E05 段 `pick-suggest:…g6-e05…` 0 条。
- 内核库 `grep -c project_source` → 0。
- E05 Goal `GoalCompleted` event #452 @01:47:26.718；t-users Run `3296b1b5` 01:42:02.594–01:42:45.317，t-orders Run `1dd97541` 01:42:46.668–01:43:13.705；两次 claim 都是 `session-128…`。
- E05 期间 local-workbench 只有 `session-128…`；第二个 `session-f6cea4…` 01:49:54.457 创建，provenance=handoff from 128，是 E06。
- 工具存在：tool-specs 工件 `1a517f10…` 含 `project_source`；`project-source-tool.ts:48,218-232`。

### UNSPECIFIED

- C 行逐条文字可读：`docs-now/refactor/reviews/evidence/slice9-rerun5-2026-11-16/README.md:11`（E05 的 C 行与每个 check 的原文，如 `overlap`、`duplicates`、`reviewer`、`name-different`、`name-same`、`line-choice`）和同目录 `checks/notes.md:12` 起（逐条 checks 原文）。缺的只是 C 行的正本 `rerun-checklist.md`，不是“原文不在 docs-now”。本诊断另用 `e05.mjs` 的判据文字、`slice-9-SPEC.md:671,680,697`、`MVP-BEHAVIOR.md:350,366,392`、`DESIGN.md:463`、`CORE-DATA-OPERATIONS.md:299`。要正本路径需 lead 补 `rerun-checklist.md`。

## E06

### 时间线

E06 复用 E05 的项目（projectId `8694c12e…`，账本 `8b0a052c…`）。01:47:34 E05 结束，E06 01:47:35–02:29:35。

- 01:47:53 选 idea 1；01:49:11 plans/apply 采用首方案；01:49:20–21 SIGINT，`resumeOnStartup=ask`，Work Run 在跑；01:49:21.853/.22.035 GoalInterruption pending→resumed（Host `onStarted`，不是人 driver-start）；01:49:32.212 驱动发换手请求（`messages/send` committed/sent）给 session-128bdfaa（`http.jsonl:179`）。
- 01:49:54.168 `SessionHandoffRecorded` accepted（trigger=tool，caller Run 2adca42c，source 128bdfaa）；01:49:54.457 接任 Session f6cea4a3（provenance.kind=handoff）；01:49:54.538 接任 Run 5632f938 领 t-long-email-tests；01:49:54.814 `HandoffBriefRecorded`，brief tasks 是 t-len-limit。
- 01:50:02.894 `SessionHandoffRecorded` 最后 revision=9、phase=running、stage=transfer、receipt=null；01:50:02.822 源线 Run 2adca42c 结束；01:50:04.954 源线又领 t-len-limit（Run 23377e07）；01:50:44.769 结束；01:50:45.034 源线再领 t-len-limit（Run 2ffd99d6）；01:51:33.876 结束；TaskReworkRefusal `no_new_basis`。
- 01:50:18 / 01:51:16 / 01:52:13 / 01:53:09 / 01:54:06 / 01:55:58 六个 intervention-planning 轮：建线、检查长度算术、planreview/planfix cbcd、planreview/planfix 04f3。之后到 02:29:34 没有新 Run/Query；02:29:34.987 驱动 pause Goal（NEEDS_DECISION/GOAL-30，`http.jsonl:257`）。

### handoff：模型做了、接任线出现了，驱动看不清

账本有 `SessionHandoffRecorded`（#550）、`SessionCreated`（#556）、`HandoffBriefRecorded`（#560）、接任 Run 5632f938。C-219 原文只要求“模型 hand_off，人批准，出现接任线”；`after_plan_confirmation` 下没有卡，`approved=0` 不违反。所以 `handoff` 应 pass。驱动 `e06.mjs:118-119` 只在 `lines/list` 的 `chainSessions` 找前任；`chainSessions` 只收 `provenance.kind==='continuation'`（`work-line-reader.ts:825`），handoff 的 provenance 是 `'handoff'`，永远不进；接任线在 `status.markers` 的 `{kind:'handoff_from', from, fromLine}`（`contracts/work-line.ts:61`；`line-status.ts:443`）。40 分钟“没有 successor”是驱动检测条件错，不是平台没做。修法：用 `status.markers.handoff_from`（或 provenance `kind==='handoff'`）认接任线。**报告把 E06 记 fail、把 fail 挂在 `handoff` 上，是驱动的错判；但 E06 仍应是 `fail`，fail 的判据应落在 `successor-input`/`history-continuity`（平台：简报未消费），不是 `handoff`。** 修驱动后重跑会命中平台 fail；平台修好 transfer 后才可能通过（`e06.mjs:19-30`、`slice-9-SPEC.md:672,680`）。

### 平台：交接的 task 转移没有完成

`HandoffBrief` 的 tasks 是 `t-len-limit`，但接任 Session f6cea4a3 实际只领到 `t-long-email-tests`；源 Session 128bdfaa 的 `SessionWorkLink` 对 t-len-limit 仍 `until=null`；源线随后连续领 t-len-limit 三次（2adca42c→23377e07→2ffd99d6），最后一次撞 `no_new_basis`。`CoreOperation session-handoff-3ca73e…` 最后 rev9 phase=running/stage=transfer/receipt=null；先 busy `archive_execution_pending: the source Task writer is still running`（`session-responsibility.ts:47`），源 Run 结束后重试变 `revision_conflict`（“the responsibility records changed since the caller read them”），之后不再重规划。根因是 `wait_writer` 只把 QueryRun 当写者：`session-handoff-service.ts:1843-1864` 的 `latestEnteredRun` 只看 QueryRun，Work Run 在跑也被当成“已停”，于是 transfer 在源 Run 还在写时先吃 busy，源 Run 结束后重放的是过期的四个 pin，再吃 revision_conflict。相关：`:1170-1185`（wait_writer 直接进 recheck）、`:1372-1392`（before 写存四个 pin）、`:1395-1399` + `:1021-1028`（receipt not_found 就重放同一保存臂）、`workflow/session-handoff.ts:136-148`。后果：C-223 `hand-or-drop`、C-135 `same-task-new-run` 若查到就是平台 fail；`successor-input`/`history-continuity` 若查到也大概率 fail（`HandoffBrief.consumedBy=null`）；现在报告记 not-run 是驱动没跑到，不是平台没做。最小改法：`latestEnteredRun` 把任意 `occupancy.kind==='execution'`（含 Work Run）都当 active，wait_writer 等它结束再进 recheck；transfer 子调用 `revision_conflict` 时重读四个 pin 并新开一代 before 写，而不是永远重放旧臂（次级，无明写冲突重读规则，标可选）。测试 `tests/work-graph/S7D1-g2-transfer.test.ts`、`tests/app/S7C-L2.test.ts`、`WP1-continuation-handover.test.ts:86`、`S6B2-handoff-brief.test.ts:121`、`S7B-V-restart.test.ts:56`。

**简报的写入和接任 Run 的次序。** `SessionCreated` 01:49:54.457 → 接任 `TaskClaimed` 01:49:54.538（t-long-email-tests）→ `HandoffBriefRecorded` 01:49:54.814 → 接任首轮 5632f938 01:49:55.329 开始。简报在接任 Run 开始前写出，但 brief 的 tasks 是 t-len-limit，接任线拿到的是另一个任务，所以没有任何一轮消费它（`consumedBy=null`）。所以只修 handoff 检测不够：`successor-input`/`history-continuity` 的最小修法与 transfer 是同一条——transfer 完成后，接任线领到 t-len-limit，它的首轮输入必须带 brief 的 reason/understanding，`consumedBy` 变非空。测试 `WP1-continuation-handover.test.ts:86`、`S6B2-handoff-brief.test.ts:121` 加“transfer 完成后接任线首轮输入含 brief 的理由/理解，`consumedBy` 非空；不能只把 brief 写出来就算”。

### 177 次调用 / 12 个叫醒轮：账是重复算的

E06 自身 98 次 `model.request_started`、61 条计费请求（55 query + 6 run）、6 个 `intervention-planning-` 轮（01:50–01:55）。README 的“E06 12”把 E05 的 6 个（01:41–01:46：建线、门注记、3 个 execreview、门注记）也算进了 E06；`e06.mjs:57-67` 把 E05 的 project 放进 E06 的 rec.projects，`run.mjs:200-230` 按 rec.projects 扫该项目的全部 Session，E05 的 6 个 job 还在 `sessions/queries` 里。E05 6 + E06 6 = 12；总 31 应为 25。E06 的 6 轮是计划候选审阅/返修，不是来回空转。修法：按 `submittedAt >= rec.facts.startedAt` 过滤，或 `p6Count` 全局去重；报告把 31 改 25、E06 12 改 6。

### 模型：第 5 轮 planreview 自相矛盾

第 5 个叫醒轮 `fbaefa`（planreview `04f3`，01:55:06.736）自己复现出 `'a'.repeat(243)+'@example.com'` = 255，前文写“243 → 长度 255（不是 254）”，后文却要求“必须改成 `'a'.repeat(243)+'@example.com'`，断言 `length===254/255`”，并据此把已经改好的候选 `04f3` 判 `fix`。`04f3` 的 `email-max-length-cases` 已经是 `'a'.repeat(254-suf.length)`，按后缀长度算；`fbaefa` 的 finding 自相矛盾，`e9aa316` 的 planfix 只能出 `ask_person` 卡（“修检查/改测试样本/两者都做”），Goal 随后停在 NEEDS_DECISION。这是模型/prompt 的 planreview 质量问题：审查必须以**候选自己的** `checks`/任务文字为对象，不能拿“平台当前装的”旧检查当候选；必须重算长度并与自己复现的数字对齐；自相矛盾的 finding 不能给 fix。补 plan-review skill 的这两句（`resources/prompts/platform/templates/skill-platform-reviewer.txt` 的 plan_review 段）。

### 逐条

- `handoff`（C-219）：**pass**，驱动误判（上）。
- `successor-input`（C-75/209/219）、`history-continuity`（C-106/194）：**not-run；若跑到，平台大概率 fail**。`HandoffBrief` 写了（tasks t-len-limit、source 128bdfaa、reason、understanding），但 `consumedBy=null`；接任首轮 `5632f938` 是 `t-long-email-tests`，没有消费简报，接任者输入拿不到前任的理由/前文。这是上一条平台 transfer 未完成的直接后果，不是驱动判错。
- `successor-frontier`（C-75）：**not-run（entry-missing）**；没有可逐字比对的义务/前沿公开原文（`e06.mjs:149` 自己记 entry-missing）；不要因 handoff 误判改口径。
- `no-restatement`（C-209）、`excluded-path`（C-209）、`same-task-new-run`（C-135）、`archive`（C-219）、`hand-or-drop`（C-223）：**not-run**，都是驱动停在 handoff 假 fail 没跑到。其中 `same-task-new-run`/`hand-or-drop` 若跑到，会因平台 transfer 未完成而 fail（t-len-limit 的负责链接仍在源线、接任线只领到 t-long-email-tests）；`archive` 若跑到应 pass（源线历史可读）；`no-restatement` 若跑到应 pass（E06 只有 1 条 `messages/send`，换手后驱动没再发信）。
- `restart-running`（C-149）：**pass**（原 Run bf59e444 crashed，继续的 Run 2adca42c 在原 Session 128bdfaa）。
- `restart-paused`（C-151）：**not-run**；这次没有“暂停中的 Goal”，是 Work Run 被重启中断；`restart-running` 才是对的判据；Q13 也没替人按。
- `wake`（C-68/181）：**not-run；若跑到应 pass**；接任线有 `5632f938`/`dfb263f0` 两个 Run，接任 Run 真的启动了。

## E08 / E08b

### E08 时间线

- 02:29:35 打开工作区；02:29:37.766 首请求 QueryJob `30599f8e…`；模型读文件、3 次 `submit_initial_plan`（前两次 schema/校验拒，第三次 accepted）；02:30:30.671 首轮 answered；02:30:34.488–34.570 人 confirm-draft/initialization adopt，采用 `initial-plan-c515…`；02:30:35.407 同草稿换 commandId 再确认 → revision_conflict；02:30:35.419 只钉 Goal 的 control → 400 invalid。
- 02:30:43.974 intervention-planning `a8edfc75…`（t1-sub 无执行者）；02:31:06-15 `query_task_graph`、`read`、两次 `create_member`；02:31:14.017 TaskClaimed（t2-mul）。
- 02:31:14.307 改需求 QueryJob `1be515c7…` 提交；02:31:14.576 entering、02:31:15.317 entered；02:31:15.346-25.535 4 次模型请求；工具 `query_task_graph`、`query_ready_tasks`、`hold_claim`、`read_requests`、`find_graph`；02:31:20.229 `hold_claim` on t1-sub committed；02:31:25.575 `submit_secretary_answer`（`ideas: []`，body “改法已交候选…”），accepted；02:31:25.774 QueryJobAnswered。
- 02:31:32.671→03:01:34.474 `plans/request-candidate` 轮询 191 次、无候选；03:01:34.584 `waitChangeCandidate` 30 分钟超时，`versions` fail；03:01:34.584 `goals/control` pause。

### 逐条

**versions（模型主/驱动判语）。** 改需求轮是 `every_step` 下的 request 轮：冻结的 `promptSet.toolNames` **没有** `submit_plan_round`，只有 `submit_secretary_answer`（`query-preparation.ts:516-523` 的 `answerPlanTool` 只在 `decisionActionPolicy(...refine_future...) === 'automatic'` 时挂 `submit_plan_round`；E08 是 `every_step`，不满足）。按秘书配方（`skill-platform-secretary.txt:14-15`），改目标/验收/任务应先用 `submit_secretary_answer` 交 2–3 个方案，人选后开规划轮出候选；模型交了 `ideas: []`，没有规划续轮、没有 `submit_plan_round`、没有候选。平台收到了并保存了文字回答（`QueryJobAnswered` 02:31:25.774），不是没收到/没保存/没审阅；`PlanProposalRecorded` 只有初始 1 条、`PlanRevisionAccepted` 只有初始 1 条。模型在 body 里写“改法已交候选”是虚报（工具只回 `{"status":"accepted"}`）。`versions` 的 fail 结果是合理的（改需求确实没发生），但根因是模型；驱动的“the platform did not do it”是固定措辞。E08 的 30 分钟等待是 lead 明示的（`driver-build-reply.md:12-13`），不要改成 E08b 的 5 分钟/not-run。

**hold-before-adopt（not-run，记法对）。** 秘书在 02:31:20.229 放了 `hold_claim`：`TaskClaimHold` `t1-sub` state=held、placedBy agent/secretary、placedAt 02:31:20.229、sub 0 Run。驱动 `e08.mjs:239` 的 `waitChangeCandidate(...,{check:'versions'})` 先超时，`e08.mjs:243-260` 的 hold 检查没执行到，not-run 正确。lead 的“秘书没放暂缓时判 fail（到了这一步该发生没发生）”不适用：秘书放了，而且根本没到这一步。报告 note 应补“暂缓已放、sub 0 Run”，但不要改 fail。

**switch / old-evidence / required-cancel（not-run，记法对）。** `switch` 在 `e08.mjs:286` 要求 `div !== undefined && (sub === undefined || sub.disposition !== 'active') && mul.effectivePhase === 'satisfied' && cancelled.ok`；没有 adopted change plan、没有 div、`plans/apply` 0 次，走不到。`old-evidence`/`required-cancel` 要读 adopted change plan/div Run，也没有。`autonomy-later` 草稿本来 every_step，没中途改档，not-run 正确。

**P6F 第 4 条“出路”。** 代码在 `plan-validation.ts:835-841`（P6F `541e542d`/`7eaeb8ee`），本轮 E08 0 次 `submit_plan_round`，没有触发；E08b 3 次 `submit_plan_round`，第 1 次 schema 拒（多余键）、第 2 次“check syntax-and-files 已装且内容不同”+“task t2 已有 Run”、第 3 次 accepted，没有一次是“无 active required carrier”的出路拒绝。所以本轮两个格都没有真正走到它；只能说“没被触发”，不能说“有效/无效”。要验证需另跑一次“模型已交 `submit_plan_round`、且取消唯一载体”的轮。

### E08b

**四条 pass 成立。** sub Run `8ea78738…` 03:50:39.834 开始；改需求 QueryJob `785f8d03…` 03:50:40.766 提交；03:51:08.429 `request_stop` on t1（ActionRequest `action_request.stop:a144…` released、TaskClaimHold stop held）；03:51:13.125 sub 说“收到叫停”；03:51:27 第 1 次 `submit_plan_round` schema 拒，03:51:39 第 2 次拒（syntax-and-files、t2 已有 Run），03:51:52 第 3 次 accepted；03:51:52.752 `PlanProposalRecorded`；sub Run 03:51:30.501 结束（completed）；03:51:55.769 人 `plans/apply` committed（busy 0），03:51:55.842 `PlanRevisionAccepted initial-plan-8fd…`；采用版 disposition `t1 active→cancelled`、`setIn` 该版本、`actor human/g6-person`。`stop.steps` requested→hold_placed→sent→delivered→run_ended。**这次能过的主因是模型交了候选**（3 次 `submit_plan_round`，第 3 次 accepted），不是驱动改了采用逻辑；驱动“没候选记 not-run”的修正本轮没被触发；`#7` busy 重试本轮 0 次、未验。`safe-point-end` 的 Run outcome 是 completed，不是 cancelled；它是收到叫停后自己清理收尾，不要写成“平台停掉了 Run”。

**待 lead：采用版 o1/o2 矛盾。** 采用版 `initial-plan-8fd…` 的 o1（required，taskIds t1/t2/g1）仍要求 sub 的验收（`sub 与 mul 的正确实现及测试`、r1“sub 与 mul 的测试用例全部通过”、r2“calc.js 导出 add/sub/mul，且 test/sub.test.js、test/mul.test.js 均存在”）；o2 又写“calc.js 不含 sub”。t1 已 cancelled、g1 superseded，o1 唯一活载体是 t2（mul）。旧检查 `syntax-and-files` 仍要求 `test/sub.test.js`（03:51:32.344 的 `TaskRequeue` 就是它 FAIL）。这看起来是采用的计划自相矛盾/旧义务不可满足；`plan-validation.ts:835-841` 只查 active required carrier，不要求旧验收随取消退休。是平台校验缺口，还是规格允许（旧 gate superseded 后不再评估 o1），要 lead 用 `STATE-MACHINES-SPEC` 的 disposition/obligation 规则裁定。裁定前不推翻 E08b 四条 pass，只把“采用后 Goal 能否完成”列为未覆盖。

## E09 / E12 / intervention

### E09

- **person-decides / new-version（模型，not-run）。** 执行者 Run `d56c903d`（task-reconcile-contract）03:05:56 用 `ask_copy` 把“用户是否已经答复 parseDate 契约”发给参谋线 `…2591c8a`。执行者的 18 次 `ModelRequestEvidenceRecorded` 工具集里没有 `ask_person`，有 `ask_copy` 和 `send_session_message`；技能写“要人定的事交参谋”（`skill-platform-work.txt:45`），`ask_copy` 写“不代替上报、问人”（`ask_copy.json:2`）。平台按 `ask_copy` 存 `answeredBy:'copy', wake:false`（`line-ask.ts:72`），只开只读副本（`consultation.ts:358-360`），副本 03:06:51 答“未收到用户答复”，不出卡；人没答卡，就没有新计划版本（`PlanRevisionAccepted` 只有 initial-plan `df650779…` 1 条，`PlanProposalRecorded` 0 条，`plans/apply` HTTP 0 次）。这是模型选路，不是平台把 `ask_person` 路由成副本。修法：执行者改走 `send_session_message`（needsReply）把冲突上报参谋线，参谋线 `ask_person` 出卡。
- **gate-contract-conflict 检查太弱（模型/计划）。** 副本明确答“未收到用户答复”，但检查只是 `grep parseDate src/api.js && grep import…parseDate…from…api.js src/report.js`，不校验返回形态；03:07:28 PASS，03:07:38 Goal COMPLETED。计划/检查是模型写的，平台按计划跑；不是平台检查器或驱动 `rounds` 判错。修法：模型把 parseDate 返回值契约写进检查（断言 Date 对象/字段形态）。
- **report-after-dispatch / diagnosis-reverify / uncovered-round（not-run，正确）。** 同目标没有 applied 派活；4 个检查轮的 `chain.reverify` 都是 null；4 个 `VerificationRoundFinalized` 都是 PASS/gaps 0，没有 INCONCLUSIVE。按 Q6/可选 not-run 正确，不补。
- **已修/已 pass：** `executor-reports`（第一轮按 `args.intent` 认上报恒 undefined；本轮按 `send_session_message`/`ask_copy` + `messageView` 认，pass）、`adviser-explains`（副本回答同时点到 `api.js`/`report.js`，pass）、`observation-after-pass`（7 次 capture 全部换新 `captureId`，pass）、`formal-change`/`drift`/`rounds` pass。

### E12

- **history-reuse（模型，not-run）。** 新 Goal `e6722b93…` 的 t2 Run `d4a3f4da…` 03:11:03–03:11:30 有 7 次 `ModelRequestEvidenceRecorded`，工具含 `look_graph`/`find_graph`/`read`/`query_task_graph`；旧 Goal `788a…` COMPLETED 且仍可读（旧线 `sessions/history` 可读、旧 Plan `initial-plan-ceb5e5c8…` 在）；新 Goal 轮的 `QueryJobAnswered.sources` 只有新 Goal/workspace，没有旧 Goal/Run。按 C-220 的可选读法记 not-run，不判 fail；模型下一轮在启动新工作前用 `look_graph` 读旧 Goal，让结果带 `goal` source。不是平台缺读口。
- **stale-premise（entry-missing，不是平台缺陷）。** 适用范围/“过期前提不升级”是模型对已查事实的取舍，公开读口没有逐项可判字段；`PlanProposal` 的 `stale/staleReason` 只判候选相对活动计划，不是“前提”字段。lead 已接受 entry-missing（`7d2-g6b-reply.md:259`）；不补读口，除非 lead 先定前提字段（无书面依据，不动）。
- **wait-registry（entry-missing，不是平台缺陷）。** 目标等待登记表是 Host 内存，`wakeLoop.start` 时只读重建（`goal-wait-wakes.ts:199-246,373,422-428`；`host.ts:1192-1197,1452-1454`；`STATE-MACHINES-SPEC.md:3697-3711,5782`）；没有公开读口；E12 本身 0 个 `waitAfterSend`，严格说这一格是 not-run。lead 已按 entry-missing 接受（`7d2-g6b-reply.md:157`），两种都未覆盖；不是平台缺行为。`STATUS.md:446` 写“不新增报告字段”。

### intervention

- **planning-when-idle / claim-once（驱动，not-run）。** 长目标期间有 95 秒（t1 03:19:30.460 结束 → t-slugify 03:21:05.891 开始）、39 秒（t-slugify 03:21:34.745 结束 → t-truncate 03:21:42）等空档；驱动的 idle/claim watcher 直到 03:23:55 才第一次读 `lines/list`/`sessions/facts`（`http.jsonl:656-662`），而长目标 03:23:52.402 已 COMPLETED。两个分支在目标结束后才打开，not-run 的判语“没有出现时刻”与账本不符。`int.mjs:250` 的 pause 分支先发 pause，`:257` `await sleep(60_000)`，idle/claim 的 `waitGoal` 到 `:263` 才启动。修法：把 watcher 提到 `driver-start` 后、pause 的 sleep 之前（或独立轮询），在第一个 95 秒空档发 `IDLE_TEXT`/`CLAIM_TEXT`；不要等 Goal 完成后才判 not-run。
- **four-endings（entry-missing，lead 已接受）。** “反问/非法”不能由驱动的公开入口造出；这次 int 的 idle 分支没走。waiting 的 609010/0b41 两轮实际出了 `needs_decision`+questions（反问形状），可作旁证；跨场景引用需 lead 同意。不改判据。
- **review-packet（not-run，按 Q7）。** 2 条直接干预被 Run 接受；没有审阅线、这个目标 0 个 `execreview` 包；计划检查里没有审阅项，平台不会自己起审阅线。P6F #4/lead 第 5 条“只看消费这条干预的 Run 所在任务（taskRef+subjectRunRef）”已照做；问题在前提（无审阅项），不在扫错入口。Q7 明确不改 REQUEST，not-run 正确。
- **completed-goal（not-run，按 lead 第 6 条）。** 完成旧 Goal 的线 `session-ae99…` 被长目标复用，`latestWork` 已是 `456148…/t-*`，不是 `2e3c…`；消息按 `intervention.ts:195` 指向当前 Goal，不会成为旧 Goal 的新目标请求。驱动 `int.mjs:420-424` 照 lead 第 6 条挑 `latestWork.task.goalId === done.goalRef.goalId`，挑不到 not-run，符合裁定。可选在长 Goal 提交前先测旧线，或带 `goalRef: done.goalRef`（后者无书面例子，需 lead）。
- **paused-queues（pass，旧根因已修）。** 暂停 03:22:20.585 在目标 RUNNING 时 committed（from active→paused），暂停中 offerable，resume 03:23:16.434 后 delivered；第一轮“pause 发在 COMPLETED 后”的根因已修。

## waiting

### 时间线

| 时刻（UTC） | 事件 | 证据 |
|---|---|---|
| 03:25:50.154 | 成员 Run 5a0d11fb 经工具发出等待 9f9f，收信人 a3f0，期限 03:27:50.154；Run yielded，continuation=wait_reply→9f9f | 账本 events #183/#184 |
| 03:25:53.430 | 人插话 92bac（`sendStatus: sent`） | `http.jsonl:708` |
| 03:26:11.333 | 9f9f 被秘书答复：`status=responded`、`response.respondedAt=03:26:11.333`、`expiredAt=null`、无 `acceptedInputs` | 9f9f snapshot rev2；events #204 |
| 03:26:04.479 | 插话被领：Run 73442e11（claim-continuation，`consumedWait=intervention`） | TaskClaimed；events #204 |
| 03:26:15 | SIGINT，Host 关闭（exit 0，3595 ms）；73442e11 在跑，未 drain | `run.mjs:318-340` |
| 03:27:50.154 | 9f9f 名义到期——但已 answered，本就不会到期 | 9f9f snapshot |
| 03:28:50.154 | 新 Host 起来 | `wait.mjs:306`；`http.jsonl:740` |
| 03:28:52.498 | 73442e11 对账为 crashed（host_interrupted） | events #213 |
| 03:28:53.2 | TaskRequeued；新 continuation Session 5e2aeefc；普通 requeue 领取 Run 8b382008（`task-claim:`，无 `consumedWait`） | events #217/#219 |
| 03:29:06.318 | 8b382008 重问 45b238（同问题，期限 03:31:06.318，`followupOf=null`） | events #233 |
| 03:31:42.117 | 45b238 真的到期（`expiredAt`，唯一一条 `SessionMessageExpired`） | events #250 |
| 03:31:42.304 | 45b238 的回复写下（到期后、消费前） | events #251 |
| 03:31:42.454 | 领取 wait_reply 续作 1b29ca00（`consumedWait.kind=wait_reply, originalRun=8b382008`） | TaskClaimed |
| 03:31:51.591 | 45b238 的回复被 1b29ca00 接受，`consumesWait:true` | 45b238 acceptedInputs |
| 03:31:51.526/.617 | 1b29ca00 发第二问 a0f8（期限 04:01:51.526），随即因 `tool_group_yield_unsettled` crashed | events #258；kernel run.failed |
| 03:32:04.373 | 4baa1b69 补发 1452（期限 04:02:04.373），open | events #272/#273 |
| 03:28:54–03:49:00 | 驱动只对 9f9f 做 `messages/read`，`repeat:129`、digest 未变；20 分钟超时 → expiry-once fail | `http.jsonl:742`；`wait.mjs:324-326` |
| 03:49:00.525 | 驱动 pause Goal，场景停 | `http.jsonl:737`；events #290 |

### 逐条

**expiry-once（驱动，fail 应 not-run）。** 驱动盯的是 9f9f，但 9f9f 在 03:26:11.333 已被答复（`expiredAt=null`、无 `acceptedInputs`），永远不会到期。`wait.mjs:324-326` 的等待谓词只看 `expiredAt`/`acceptedInputs`，不看 `response`；`flows.mjs:44-53` 的 `waitFor` 超时后 `broken()` 把超时记成“the platform did not do it”。平台在这 20 分钟里确实处理了一次到期：45b238 的 `SessionMessageExpired` 03:31:42.117，03:31:42.454 领取 wait_reply 续作，03:31:51.591 接受回复并 `consumesWait:true`（`STATE-MACHINES-SPEC.md:3650` 的正确路径）。所以这条应为 `uncovered (not-run)`（“收信方在到期记下之前就回答了”），不是平台 fail。修法：`wait.mjs:324-326` 谓词加 `|| value?.response != null`，让 `:328` 的 not-run 分支生效；改盯当前等待（45b238/续作），不是只盯 9f9f。

**restart-kept（平台主/驱动次，not-run）。** 记录的 kept 半边成立：重启后 `messages/read 9f9f` 仍是同一 messageRef、同一收信人、同一期限 03:27:50.154（digest 未变）。但没有任何 Run 消费它：9f9f 的 `acceptedInputs` 始终为空；重启后的 8b382008 是普通 requeue 领取（`task-claim:`，不是 `claim-continuation:`，无 `consumedWait`），不是 wait_reply 续作。原因链：插话 Run 73442e11 按 D-04 拿了这条任务、关闭时被打断成 crashed；重启的 requeue 只带“自动恢复”通知（wake:false），不带 9f9f 的回复；`workflow.ts:1548-1562` 的 `readContinuation` 只看紧邻的上一条 yielded Run，中间夹 intervention/crash 就找不到 5a0d11fb 的 wait_reply 基。续作 Session 5e2aeefc 还读不到旧 Session 发的 9f9f：kernel `tool.failed` `forbidden: this message is not addressed to or sent by the caller Session`（`mailbox-access.ts:101`），模型因此重问。平台改法：接续/重排队带上“这条任务上一条 yielded 等待的 wait_reply 基”（或把已保存的回复作为下一轮输入）；允许 continuation Session 读 `provenance.from` 发的等待。测试：`tests/scenarios/S7B-V-wait-kept.test.ts:30`、`tests/business/S7B1-B-continuation.test.ts:51/153`、`tests/scenarios/S7B-V-restart.test.ts:56`。驱动改法：插话后等 Run 结束再关，或把“Run 仍活着就关”显式记成 interrupted、restart-kept 记 not-run；重启后把成员线重解析到 continuation Session。

**second-expiry（平台因/模型次，not-run）。** `messageRefOf` 已修（`flows.mjs:1118-1128`、`wait.mjs:154-160`）；这次链只有 `[9f9f]`，模型重问的 45b238 `followupOf=null`，不是追问链；9f9f 也没到期，`expired=0`。模型为什么重问：平台没把 9f9f 的回复送到续作，续作也读不到 9f9f；模型只知道“上次中断、没有新输入”，按任务书第 1 步重发。它保留了 9f9f 的 ref，本可带 `followupOf`；这是模型/skill 的次因。平台先修“reply 到续作”，模型侧重问必须带 `followupOf=原消息`。

**consumes / late-reply（驱动，not-run）。** `wait.mjs:369-371` 拿 `chain[0]`（9f9f）判 `acceptedInputs.filter(consumesWait).length===1`；9f9f 的 `acceptedInputs` 是空，必 fail。真正有一次且只有一次消费的是 45b238（`part=response`、`consumesWait:true`、acceptedAt 03:31:51.591、Run 1b29ca00）。`lateSaved` 以 `expiredAt` 为界，会把 45b238 这种“到期后、消费前”的正式回复当迟回，并因 `responseConsumed=true` 判 fail；`STATE-MACHINES-SPEC.md:3650` 明说这种回复读作 answered、领取选 `wait_reply`，到期已被接受之后的回复才是普通迟到输入。修法：用“当前这条等待”判 consumes；迟回起点改为“有 expiry 接受/到期已被消费之后”。

**reply-first / transfer / disconnect（驱动主/模型次，not-run）。** 第二问其实已经发出：a0f8（Run 1b29ca00，03:31:51.526，期限 04:01:51.526）与补发 1452（Run 4baa1b69，03:32:04.373，期限 04:02:04.373），停下时都还 open、无回复。驱动 `member` 只在 `wait.mjs:219` 解析一次（旧 Session 24660bf3），`memberSends(member)`/`waitsOf(member)` 看不到 5e2aeefc 发的这两条，即使跑到也只会空等 30 分钟。另：a0f8 的 Run 1b29ca00 因等待发信同组还有两个 read 被 Kernel 判 `tool_group_yield_unsettled` crashed；这是冻结 Kernel 的已知行为，不是平台 bug，但 `send_session_message` 工具说明和 skill 没写“`waitAfterSend` 时本轮只发这一条，同组不要再放别的调用”，模型照说明做就会撞。驱动改法：重启后把成员线重解析到 continuation Session；模型/skill：`waitAfterSend` 轮里不要同组放别的调用。

**supply-order（驱动，not-run）。** `wait.mjs:442` 无条件记 `entry-missing`，从不尝试。精确的“供给顺序”没有公开逐项读口；驱动的 `sessionTurns` 已能读 turn 输入，续作 brief 的“已接受的输入”按人消息→平台通知列了。最多做到“读 turn 输入作旁证”；不新增机制。

### 否定证据

- waiting 的 HTTP 共 76 行（`grep -c '"scenario":"waiting"' checks/http.jsonl` → 76）；重启后到超时只有 1 行（`http.jsonl:742`，`repeat:129`），期间没有 `waits/dispose`、`sessions/archive-line`、`goals/create`、`messages/send`（各 `grep -c` → 0）。
- 账本 `SessionMessageExpired` 只有 1 条（`grep -c SessionMessageExpired events.txt` → 1），是 45b238；9f9f 的 `expiredAt` 为 null、无 `acceptedInputs`。
- 03:33:36 之后到 03:49:00 没有事件（events #289→#290）；waiting 最后一条模型调用 03:32:59.812（`model-calls.jsonl:267/268`）。
- 第二问停下时仍 open：a0f8 snapshot rev1（`response=null, expiredAt=null`）、1452 snapshot rev2（`response=null, expiredAt=null`）。
- 续作 Session 读 9f9f 被拒：kernel `tool.failed`、code `forbidden`、reason 原文见上；`mailbox-access.ts:101`。
- 重启后没有 `workflow/driver-start` 的 HTTP 行；Goal 的 resumed 来自 Host `onStarted`（`host.ts:1783-1786`）。

## 叫醒轮

- **真实 25 个，不是 31。** 八个账本 `COUNT(DISTINCT aggregateId)`：e05 12（E05 6 + E06 6）、e08 1、e08b 2、e09 1、e12 1、int 3、iter 1、wait 4 = 25。README 的 E06 12 是 E05 的 6 + E06 自己的 6；`e06.mjs:57-67` 把 E05 的 project 放进 E06 的 rec.projects，`run.mjs:214-220` 按 rec.projects 扫该项目的全部 Session，`report.mjs:82-86` 只在同一 unit 内去重，跨 unit 没去重。修法：`submittedAt >= rec.facts.startedAt` 过滤或全局去重；报告把 31 改 25、E06 12 改 6。
- **没有来回叫醒链。** 25 轮里 21 轮的源消息是平台（host），只有 4 轮是线到线；0 条“叫醒轮 A 发出的信成为叫醒轮 B 的 sourceMessageRef”的边；同一对线最多 3 轮（waiting 执行者→秘书，同向，不交替）；严格交替最长 1 轮。T6 的“两条线来回超过 5 轮、且中间轮只回收到”（`design-frozen.md:876`）两个条件都不满足，**不触发 T6，不加叫醒链深度上限**。
- **“只回收到”的 1 个是假阳性。** waiting 的 `intervention-planning-d56f1831a469…`（03:26:04→03:26:11）是执行者问“num.js 现在有哪些导出函数？”；它的工具只有读类和答复，最终答复是实质回答“I have the answer… double(n)”，平台把它作为 9f9f 的 response 写下（03:26:11.333）。`run.mjs:219-225` 只看成功工具是否都在 READ_OR_REPLY，不看 final/response，所以把它计成 ack-only。修法：排除该 QueryJob 产出的 response/answer 或 final 不是纯确认的轮；只计数、不判 fail（Q11）。

## 说不清的

1. **E08b 采用版 o1/o2 矛盾（最需要 lead 看）。** 采用版 `initial-plan-8fd…` 的 o1 仍要求 sub 的测试/实现，o2 又写“calc.js 不含 sub”；旧检查 `syntax-and-files` 仍要求 `test/sub.test.js`。是平台校验缺口（应拒绝“旧 required 义务的唯一活载体不再能覆盖旧验收”的候选），还是规格允许（旧 gate superseded 后不再评估 o1），还是模型应把 o1 标 superseded/改验收（第一轮配方说保留 o-sub，需先改配方）？裁定前不推翻 E08b 四条 pass，只把“采用后 Goal 能否完成”列为未覆盖。
2. **E06 `hand-or-drop`/`same-task-new-run` 的平台修法可能动接口。** 需要 lead 排：是只修 `session-handoff-service` 的 pin 重读，还是把 task 转移/席位释放的形状一起改；会碰 `session-handoff-service.ts`、`workflow/session-handoff.ts`、`session-responsibility.ts`。
3. **waiting 的 `ask` 语义。** 03:28:52.624 写 pending，03:28:53.061 就 resumed，触发是启动 auto-requeue 的 driver start（`host.ts:1783-1786` 的 `onStarted`），不是人的 `workflow/driver-start`。这符合“重新排队可以叫醒在等的目标”（`MVP-BEHAVIOR.md:308`），但和“ask 等人继续”的读法有张力；若按后者，本次续作 Run 根本不该开。交 lead。
4. **E05 的 C 行正本缺 `rerun-checklist.md`。** 逐条文字在 `docs-now/refactor/reviews/evidence/slice9-rerun5-2026-11-16/README.md:11` 和 `checks/notes.md:12` 起可读；缺的是正本文件本身。要正本路径需 lead 补。
5. **E08b `delivered` 没有独立时间戳。** 账本有 `ActionRequest released` 03:51:08.429、`TaskClaimHold stop` 03:51:08.429；`delivered` 只在驱动任务卡 `stop.steps`（notes:308）和 Run 03:51:13.125 的“收到叫停”里。证据足够判 pass，但严格说“delivered 的时刻”是推断到 03:51:09.839 之前的某刻。

## 建议的优先级

1. **驱动先修“假 fail”**，否则报告继续把平台/模型问题读成平台没做：E05 `reviewer/name-*` 数组形状（`e05.mjs:269`）、E05 `line-choice` 读 `last.pick`（`e05.mjs:300`）、E06 `handoff` 认 `handoff_from`（`e06.mjs:118-119`）、waiting `expiry-once` 谓词（`wait.mjs:324-326`）、waiting 成员线重解析（`wait.mjs:219`）、intervention idle/claim watcher 提前（`int.mjs:250,257,263`）、叫醒轮 31→25（`run.mjs:214-220`/`report.mjs:82-86`）。
2. **平台修两处真缺口**：E06 交接 task 转移（`session-handoff-service.ts` 的 pin 重读）、waiting 续作的 wait_reply 基/读权（`workflow.ts:1548-1562`、`mailbox-access.ts:101`）。
3. **模型/skill 修配方**：E05 `project_source compare`/plannedFiles、E08 改需求先交 2–3 个方案且不虚报候选、E09 改走 `send_session_message` 上报参谋并把契约校验写进 gate 检查、E12 启动新工作前读旧 Goal、waiting 重问带 `followupOf` 且 `waitAfterSend` 同组不放读、E06 planreview 以候选自己的 `checks` 为审查对象并拒绝自相矛盾的 finding。
4. **lead 裁**：E08b o1/o2、E06 task 转移修法、waiting `ask` 语义、E05 C 行正本（`rerun-checklist.md`）路径。

## 证据位置

- 运行报告：`.dsh-ref/p6/report/README.md`、`result.json`、`checks/notes.md`、`checks/http.jsonl`、`checks/model-calls.jsonl`、`checks/commands.txt`。
- 运行快照：`.dsh-ref/p6/run/w-accept/`；各场景账本在 `projects/<场景>/.git/workbench/projects/<id>/ledger.sqlite`（E06 用 E05 的 e05 库）。
- 子任务详细报告：`.dsh-scratch/p6d2/e05/report.md`、`e06/`（协调者按 E06 子任务中途回报和账本复核整理）、`e08/report.md`、`wait/report.md`、`e09e12int/report.md`。
- 旧根因：`.dsh-ref/n1118/p6-diagnosis.md`；驱动清单/裁定：`.dsh-ref/n1118/driver-fix-list.md`、`driver-rulings.md`、`driver-build-reply.md`。
- P6 观察点：`.dsh-ref/n1118/design-frozen.md:833-840`；T6：`.dsh-ref/n1118/design-frozen.md:876`。
- 规格：`.dsh-ref/docs-now/MVP-BEHAVIOR.md:308,320-324,350,366,377,392`；`.dsh-ref/docs-now/refactor/STATE-MACHINES-SPEC.md:535-537,563,3650,3697-3711,3727`；`.dsh-ref/docs-now/refactor/design/orchestration-2026-10/slices/slice-9-SPEC.md:667-680,738-777`；`.dsh-ref/docs-now/PRODUCT.md:378`。
