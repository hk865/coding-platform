# P6（G6 第十二次补跑）只读诊断

- 运行：`g6-2026-11-24-46014f5e`，2026-11-24T20:05:46Z–22:11:53Z；树 `fa76fe99`（平台 `7f518eb4` + 驱动 `fa76fe99`，HEAD 只改 `scripts/acceptance/`）。
- 结果：八个主场景 total=8 / pass=0 / fail=6 / uncovered=2，另 E08b fail。
- 口径：**平台** = `src/` 的行为不符合 `docs-now` 的规格或决定；**驱动** = `scripts/acceptance/` 判错、等错或发错；**模型** = 平台和驱动都照规矩，模型该做没做。
- P6 观察点：`.dsh-ref/n1118/design-frozen.md:833-840`（E08、E09、直接干预、等待；没走到的支路记未覆盖）。
- 本轮只读：未改代码、未提交、未起 Host、未调模型；证据来自账本只读副本、`checks/http.jsonl`、`checks/model-calls.jsonl`、Host 日志、代码/规格 grep。`sqlite3` CLI 未装，账本用 `python3` 的 `sqlite3` 模块查副本。

## 结论总表

| 场景 | 判据 | 类别 | 一句话根因 | 证据 | 建议改法 | 谁来改 |
|---|---|---|---|---|---|---|
| E05 | overlap（C-182/183/217；其余 gate/paths/kept/single-occupancy/convention/duplicates/reviewer/name-different/name-same/temporary/line-choice 全 not-run） | **平台（主）/模型（次）** | 目标循环给“建执行者线”的 `pick-suggest:t1` 建议信（wake:true、needsReply:true）被送进正在跑的冷启动 coarse_split 轮；该轮没有 `create_member`，信被记 `delivered` 后不再开轮，没人建线，目标以 `suggestion_committed: the repeated pass performs no step` 空等 32 分钟 | 20:06:27.652 `initialization/adopt`（`http.jsonl:7`）；20:06:28.391 `SessionMessageSent` `pick-suggest:t1:…`；20:06:33.272 kernel `run.input_accepted` 位 4；20:07:12.129 轮 `run.completed`；20:07:12.267 记 `delivered`；20:07:12.388 答 coarse split；此后无新 Query、0 Work Run | 平台：`execution-inputs.ts:296/438` 对 `pick-suggest:` 加“本轮有 `create_member` 才供入”，否则留 `queued`；冷启动轮结束后按 `query-preparation.ts:88-101` 开参谋规划轮。模型：skill 补“不能建线就回信” | 平台（lead 排）+ 模型/skill |
| E06 | 全部 12 条 | **连带（无独立根因）** | E05 未写 `ctx.shared.e05`，E06 立即 Abort，0 请求、0 token | `e06.mjs:57-58`；result.json E06 20:38:30.546→.600；无 `projects/e06` | 修 E05 后重跑 | — |
| iteration | ideas（C-108） | **平台（主）/驱动（次）** | adopt 把未跟踪、只读挂载的 `.workbench/` 写进工作区；检查的 `git status` 恒见它，`readme-example-static` 恒 FAIL；第 2 次自动返工因依据相同被正确拒 `no_new_basis`；目标转 NEEDS_DECISION。驱动把这次停记到从未执行的 ideas | `http.jsonl:274` 只有 1 次 `requests/submit`（seed）；`.workbench` 20:51:22.549Z 落盘；ledger #161/#199 `readme-example-static` FAIL、`node-test` PASS；#200 `operation=requeue`、`basisDigest=58bd1190…`、`matchedRequeueRef=a0762881`、`sourceDigest=1bb3021a…` 两轮相同；`iter.mjs:52` 未传 `check`/`returnOnDecide` | 平台：检查的工作区视图排除 `.workbench`（或 adopt 写 `info/exclude`）；并补一条无参谋/秘书线时执行者→人的上报通道（`MVP-BEHAVIOR.md:244` 的“没有参谋可问时问人”）。驱动：`iter.mjs:52` 传 `check`/`returnOnDecide`，停不得落到首个未判判据 | 平台（lead 排）+ 驱动 |
| intervention | paused-queues（C-197） | **驱动** | pause 发在 Goal `COMPLETED` 之后 5 秒，平台按 GOAL-04 正确拒 `invalid`；驱动不看 `paused.status`，继续发“暂停中”消息、发 resume（被 `busy: not paused` 拒），再空等 30 分钟 | GoalPhase COMPLETED 21:00:56.267；21:01:01.989 pause `http:400` `invalid` “the Goal is completed for its active Plan; it has no work to stop”（`http.jsonl:359`）；21:01:01.992 发 PAUSED_TEXT（`:360`）；21:01:59.373 resume `http:409` `busy` “the Goal is not paused”（`:361`）；`GoalDesiredStateChanged` 0 行 | `int.mjs`：pause 提前到看到 running Run 后立即发，发前读 `goals/display` 验 phase；`paused.status !== 'committed'` 时记 `uncover('paused-queues','not-run',…)` 并跳过；`GoalPhase` 用 `tasks/query` 的 completion 实际 revision，不硬编码 0 | 驱动 |
| waiting | second-expiry（C-171/190/224） | **驱动** | 共享 helper `messageRefOf` 在追问的 send 结果里先取到 `followupOf` 的原消息（`647b`），`chainRefs` 变成 `[647b, 647b]`；同一个 `647b` 被数成两次到期，`second` 也是它自己，所以找不到“第 2 次到期”。不是 `48f4` 并链 | `checks/notes.md:190` 的链是 `647b → 647b`；`flows.mjs:1115-1116` 的 `findAll(...)[0]`；`wait.mjs:167-182`；`48f4.followupOf=null`、`expiryCount=1` | 驱动：`messageRefOf` 取 `values[0].message.ref` 或排除 `followupOf`；`chainRefs` 去重；`wait.mjs:119`、`e09.mjs:131/199` 三处复用同一修法。平台旁证：`60c30b52` crashed 的等待不唤醒是另一缺口 | 驱动（主）；平台另案 |
| waiting | transfer（C-224） | **驱动** | 平台按规格只在等待的发信线 archived/archiving/retired 时允许 transfer；成员发信线未归档，拒 `invalid waiting_line_live` 正确；驱动未归档成员线就先转交，失败即判 fail | `http.jsonl:459` 21:40:14.821 `waits/dispose` → `invalid`/`waiting_line_live`；`STATE-MACHINES-SPEC.md:3727`；`message-machine.ts:1185-1194`；成员最后 Run 21:40:04 已结束，但“live”指线未归档；54ms 后归档的是收信秘书线，不是发信成员线；`wait.mjs:418-422` 只发一次 | 驱动：先归档/退役成员线再 transfer，或记 `uncover` | 驱动 |
| E09 | observation-after-pass（C-98） | **平台** | 规格要求每次正式检查 PASS 后抓观测；平台每次 PASS 都发 capture（events 269/282/300/314 `trigger=check_passed`），但 8 次全失败，`captureId` 仍是 `ca125a3e` | `PRODUCT.md:378`；错误 `invalid … observed architecture body has an invalid architecture snapshot`（`architecture-service.ts:1166`、codec `:442`）；adopted catalog `tests.paths=["test/"]`（event 64/323）；`architecture-source.ts:69`、`workspace-path.ts:24` 拒尾斜杠，`mappingsOf` 原样传（`architecture-catalog.ts:86`） | 平台：`mappingsOf`/采用时把 `test/` 规范成 `test` 或拒绝；测试行：catalog `paths=['test/']` 时 capture 成功并换新 captureId | 平台（lead 排） |
| E09 | adviser-explains（C-211） | **驱动** | 参谋轮 final 20:46:41.546 同时写了 `api.js` 和 `report.js`；驱动在 20:46:22 人答卡、`waitGoal(returnOnDecide)` 返回时就取了 `turnsByDuty` 快照，20:46:41 的 final 轮不在 `received` 里，所以 `explained` 为空 | kernel `89503e8d` pos 54 是上报输入，pos 66 `ask_person` 只写 `api.js`，pos 89 final 写两者；pos 90 `run.completed` 的 `finalMessageId` 就是它；`e09.mjs:89-93` 取快照，`:176` 用它；`notes.md:86` 人答卡 20:46:22.340 | 驱动：判 `adviser-explains` 前重读参谋线的 `turnsByDuty`/`sessionTurns`（等 report 的答复轮），把 final 轮纳入 `received`；`explainTexts` 不用改 | 驱动 |
| E08 | switch（C-210） | **模型** | 模型 8 次试“取消/替代 `t-sub`”都被 `plan-validation` 拒（`o-sub` 无 active required carrier，`plan-validation.ts:828-837`），第 9 次保留 `t-sub` active 才交；候选只有 2 条、无 cancelled，采用版自然没有 sub 条目，不是采用时丢失 | 候选 `proposal-2ad6`：`t-sub=active`、`o-sub.taskIds=[t-sub]`；采用版 `bf1f6` 的 `dispositionRecord.entries` 只有 `t-accept→superseded`；`1f838245`/`krun-6822` 有 8 次 `submit_plan_round` 被拒；`STATE-MACHINES-SPEC.md:535-537`、`:563`；驱动 switch 判据正确（`e08.mjs:262-265`） | 模型/skill：加“有痕任务替代/取消”配方——`t-sub` 只改 disposition，`o-sub` 原样并把 `t-div` 加入 `taskIds`，新验收另开 obligation；自检旧任务不得 active。测试行：`A2-disposition-change.test.ts` 替代后 `t-sub=cancelled` 且 `dispositionRecord` 有该条 | 模型/提示词 |
| E08b | adopt-after-end（C-210；stop-delivered/safe-point-end 记 not-run） | **模型（主）/驱动（次）** | 改需求 QueryJob 21:41:26 开跑；模型 21:41:44 只交 prose `submit_secretary_answer`，没调 `submit_plan_round`；平台 21:41:49.324 发 `invalid_plan`；候选从未产生，30 分钟超时。驱动超时后把 `adopt-after-end` 判 fail（没有采用发生，应 not-run） | 改需求提交 `http.jsonl:501` 21:41:26.691；`plans/request-candidate` 21:41:45.508 起 `repeat:187` 到 22:11:53.821（`:540`）；`plans/apply` 0 行；`e08b.mjs:113-115` | 模型/skill：声称已交候选不算，必须调 `submit_plan_round`。驱动：末轮非 plan / 收到 `invalid_plan` 时立即结束；超时后三条都记 not-run | 模型 + 驱动 |
| 记账 | 叫醒轮 0 个 | **驱动（记账）** | `run.mjs:214` 用 `turn.runId` 前缀 `intervention-planning-` 判，但 history 的 `turn.runId` 是 Kernel 的 `krun-…`，不是 QueryRun 的 `intervention-planning-run-…`；实际 13 轮，不是 0 | `run.mjs:214`；`flows.mjs:900-930` 的 turn 构造；账本 `QueryJobSubmitted` 且 `aggregateId LIKE 'intervention-planning-%'` 共 13 个：E08 1、E09 2、E12 1、iteration 2、intervention 2、waiting 3、E08b 2；只回“收到”1 个（waiting `132fc967`） | 驱动：用 `queryJobId → executionState.entry.kernel.runId` 映射后再数 turn | 驱动 |

**计数：** 平台 3（E05、iteration、E09 observation-after-pass）；驱动 4（intervention、waiting second-expiry、waiting transfer、E09 adviser-explains），另记账 1（叫醒轮）；模型 2（E08、E08b）；连带未覆盖 1（E06）。E08 的 `hold-before-adopt`、E08b 的 `stop-delivered`/`safe-point-end` 是未走到/超时后的 not-run，不算独立 fail。

**最要紧三条：**

1. **E05 平台死锁**：一封“建线”建议信被送进没有 `create_member` 的冷启动轮，记 `delivered` 后平台不再开轮，目标空等 32 分钟，并把 E06 整场拖成未覆盖。
2. **iteration 平台检查环境**：`.workbench/` 被 adopt 写进工作区，检查的 `git status` 永远看到未跟踪文件；模型改不动只读挂载，第二次返工被正确的 `no_new_basis` 拒，目标转 NEEDS_DECISION。这不是单场景问题，凡是“用 git status 自检只改了一个文件”的检查都会中。
3. **E09 观测捕获全失败**：每次检查 PASS 都触发 capture，但 adopted catalog 的 `test/` 尾斜杠让 codec 每次都拒，架构观测永远停在上一次。

## E05（含 E06）

### 现象与时间线

E05 从 20:05:48 开始，最后一条写命令是 20:06:27.652 的 `initialization/adopt`（`http.jsonl:7`）。20:06:28.391 目标循环写出一条 `SessionMessageSent`，键为 `pick-suggest:t1:…`，`wake:true`、`needsReply:true`，收件是参谋线。此时参谋线正在跑冷启动的 coarse_split 轮（`session-baaf`），该轮在 20:06:33.272 的 `run.input_accepted` 第 4 位收下这封信；20:07:12.129 轮 `run.completed`，20:07:12.267 Host 把这封信记 `delivered`，20:07:12.388 轮给出 coarse split 答复。之后到 20:38:30 只有 `workflow/driver-read` 和读口轮询，没有新的 Query、没有 `claim`、没有 Work Run（`result.json` E05：结束的 Run 0）。

驱动在 20:08:34 读一次 `workflow/driver-read`，之后每 10 秒读 `goals/display`/`decisions/queue`；32 分钟后走 `flows.mjs` 的 32 分钟出口，拼出 `the platform stopped: …` 之前先读到目标仍是 RUNNING、停因却是 `suggestion_committed: the repeated pass performs no step`，于是记成 “stalled: no change for 32 min, nothing in flight”。

### 根因链

1. 目标循环发现 `t1` 没有执行线，生成 `pick-suggest:t1:…` 建议信，要求收件人建线（`workflow.ts:2141-2148` 的建议正文与收件人；`workflow.ts:3012-3018` 的 `suggestion_committed` 等待）。
2. 这封信的 sender 是平台 `workflow:auto-rework`，`wake:true`、`needsReply:true`；按 `MVP-BEHAVIOR.md:310` 的“要回复的消息必须叫醒”，它必须叫醒。平台把它投给正在干活的参谋线，`consumable-sessions.ts` 的供给把它送进当前轮；但这一轮是冷启动 coarse split，不能建线。该轮是冷启动 coarse split，工具集里没有 `create_member`（`query-preparation.ts:88-101` 的 `adviserMemberRound` 只给 intervention_planning/plan_round 或文字形状保留 `create_member`；冷启动轮不满足）。
3. `message-machine.ts:1058-1059` 的 delivery 分支在 `delivered` 后返回 `offerable:false, reason:'delivered'`；Host 不再为这封信开轮。`execution-inputs.ts:296/438` 只有“本轮没有 `respond_session_message`”才把 needsReply 信留在队列；这轮有 respond，所以没有拦。
4. 目标循环再跑一遍，建议的 send 回执已是 `committed`，于是 `workflow.ts:3014-3018` 返回 `suggestion_committed: the repeated pass performs no step`，`goalWaitBasisOf(goal,['suggestion_committed'],['Session','CoreOperation'])` 算出“没有新依据”，目标停在 RUNNING。
5. 参谋模型在这轮只做了 coarse split，没有用 `respond_session_message` 回这封信（20:07:12.388 的 4898 字答复未提 t1）。这是次因：平台不该把需要 `create_member` 的信送进没有该工具的轮，但轮里确实有回复工具，模型也没有回。

### P2–GL 四处逐条

| 改动 | 结论 | 理由 |
|---|---|---|
| 默认叫醒 | **有关（主因）** | 发信方是平台 `workflow:auto-rework`，`wake:true`、`needsReply:true`，按“要回复的消息必须叫醒”必须叫醒；但 `MVP-BEHAVIOR.md:310` 同时要求“叫醒只是为这条消息开一轮读信、回话”。平台把它送进正在跑的、不能建线的冷启动轮，记 delivered 后不再开轮，违背后半句。 |
| 回复不开轮 | **无关** | 这里根本没有回复；是平台自己的 `pick-suggest` 建议信，不是对某条消息的 response。 |
| 动作和消息分开 | **有关（形状）** | 走的是 message 分支，但建议要的动作是 `create_member`；该轮没有这个工具，平台也没有 `host_pick_member` 之类的所有者接手。消息和它要求的动作被拆到了两个都不完整的地方。 |
| GL 的领取守卫 | **无关** | `workflow.ts:2653-2657` 只在 requeue 分支；`src/core/work-graph/tasks/overlap-gates.ts:455-468` 是 release 判定。本场 0 Run、0 claim，领取守卫没有执行。 |

### 分类与改法

**平台（主）。** 违反 `MVP-BEHAVIOR.md:310`（叫醒要开一轮读信回话）和 `design-frozen.md:210-211`（没供给的正文不记已送达；在等回复的线 agent 消息不叫醒）。最小改法有两个方向，lead 定：① 在 `execution-inputs.ts:296/438` 的“本轮不能回复”守卫旁，再给 `pick-suggest:` 加一条“本轮没有 `create_member` 就不供入、保持 `queued`”，线空闲时由叫醒/开轮侧（复用 `query-preparation.ts:88-101` 保留 `create_member` 的路径）开一轮参谋规划轮；② 不在消费侧拦，而是在当前轮结束后检查这封 `delivered` 且未回、且需要 `create_member` 的建议信，补开一轮能建线的执行/规划轮。两者都比现在“送进不能建线的轮、记 delivered 后不再开轮”好；不要用 `wake:false`，因为 `needsReply` 的信按同一句必须叫醒。测试行：`tests/runtime/R4b-session-input-boundaries.test.ts` —— 一轮工具没有 `create_member`、队列里有一封 `needsReply` 的 `pick-suggest:t1:p`，供入 0 条、`delivery` 仍为 `queued`；下一拍工具含 `create_member` 的规划轮供入 1 条。

**模型（次）。** 轮 20:06:33–20:07:12 拿到了这封信，也有 `respond_session_message`，但没有回。skill 缺口：`skill-platform-adviser.txt:148-155` 只在 `{{#tool:create_member}}` 块里讲建线，没有讲“收到建线建议但本轮不能建线时怎么回”。补一句“不能建线就用 respond_session_message 回一句，不要沉默”即可；这不是主因，单独修平台也能解。

**E06（连带）。** `e06.mjs:57-58` 因为 E05 没有写 `ctx.shared.e05` 立即 Abort；`result.json` E06 20:38:30.546→.600，0 请求、0 token、没有 `projects/e06`。修 E05 后 E06 自然有项目可续，不需要单独改 E06。

### 否定证据

- E05 段 `http.jsonl` 共 34 行（`grep -c '"scenario":"E05"' checks/http.jsonl` → 34）；20:07:12 之后到 20:38:30 没有 `requests/submit`、`initialization/adopt`、`messages/send`（`grep '"scenario":"E05"' … | grep -E 'requests/submit|initialization/adopt|messages/send'` → 0 行），只有 `workflow/driver-read`、`goals/display`、`decisions/queue` 和最后的 pause。
- E05 的 `QueryJob` 共 15 条 `model-calls` 行（`grep -c '"unit":"E05"' checks/model-calls.jsonl` → 15），全部是 Query，没有 Work Run；`result.json` 说“结束的 Run 0”。
- 20:06:33.272 的 `run.input_accepted` 和 20:07:12.267 的 `delivered` 是账本 `events`/`snapshots` 的读数；详细 SQL 与行号见 `.dsh-scratch/s1-e05/report.md`。

## iteration

### 现象与时间线

20:50:42 开项目，20:50:44 提交 seed（`http.jsonl:274`，iteration 段 49 行里唯一一次 `requests/submit`），20:51:22 确认并 adopt（`:276/:277`），`.workbench/` 在 20:51:22.549 落盘。20:51:48 `t1` 领取（ledger #124），20:52:07 第一个 Run `a0762881` 结束、第 1 轮 `readme-example-static` FAIL、`node-test` PASS，随后 auto-requeue #1（#155/#161/#162）；20:52:08 第二个 Run `a978b8d2`（#163/#193），20:52:53 同样 FAIL，第 2 次 requeue 被拒 `no_new_basis`（#199/#200）。20:52:59–20:53:38 目标显示两分钟无变化，驱动判停（`iter.mjs:298-301`），20:55:54 pause。

### 根因链

1. 平台在 adopt 后把 `.workbench/architecture.json` 和 `.workbench/modules/*.json` 写进项目工作区；它们是未跟踪文件，且 `.workbench`/`.git` 在这次运行里是只读 bind mount（kernel 第 2 轮 `mount` 输出），执行者无法用 `.gitignore` 或 `mv` 隐藏。
2. 计划里的检查 `readme-example-static` 由模型写成 `git status | grep -vc '^.. README.md$'` 一类的三段式；前两段为 0，第三段恒为 1（`.workbench` 是未跟踪项）。平台自己的改动范围读口反而排除 `.workbench`（`candidate-workspace-reader.ts:10-12` 的 `withinKnowledgeDirectory`；快照 `changedFiles` 只有 `README.md`），两边对“工作区里有什么”不一致。
3. 第 1 轮 FAIL 后平台自动返工；第 2 轮同样 FAIL，`requeueBasisCompared` 对 system auto-rework 成立（`requeue-service.ts:1428-1436`），第 2 次 `basis.digest` 命中第 1 次，`TaskReworkRefused code=no_new_basis`（#200），`task-failure.ts:959-960` 走 AV-9，目标转 NEEDS_DECISION（`STATE-MACHINES-SPEC.md:1032` TASK-28、`:1211` AV-9、`:283/:300`）。**这条拒绝本身合规。**
4. 目标没有参谋/秘书线，执行者在第 2 轮末条写明“本目标没有参谋/秘书线……无法把此事发出”，平台没有执行者→人的上报通道；这使“检查环境有问题”无法升级成人能看到的卡。
5. 驱动 `iter.mjs:52` 等的是 seed 目标，没传 `check`/`returnOnDecide`；`waitFor` 的 ended 走 `broken(ctx,text,undefined)`（`flows.mjs:232-243`、`:49-53`），失败落到首个未判的 `ideas`。而 `ideas` 要的是“先给 2–3 个思路”（`iter.mjs:26`、`slice-9-SPEC.md:676`），本次一个都没请求（`:55` 的 ASK_IDEAS 未发出），所以这条 fail 是错挂。

### 分类与改法

**平台（主）。** 违反平台自己对“改动范围”的口径（`candidate-workspace-reader.ts:10-12` 排除 `.workbench`），也让检查看到不该看到的未跟踪文件；HANDOFF 的存储决定要求 `.workbench/` 对 Agent 只读、按仓库用 `info/exclude` 留在本机（`HANDOFF.md:2708`、`:2717`），而这次检查的 git 视图里它是未跟踪项；`HANDOFF.md:3268` 已记同类：“E05 模型写的检查用 git status……永远失败，返工以‘没有新依据’被拒”。最小改法：检查执行时用平台自己的 source 路径集（排除 `.workbench`），或 adopt 时把 `.workbench` 放进 `info/exclude`/自忽略，禁止它出现在检查的 git 视图。测试行：adopt 后含只读 `.workbench` 的工作区跑 `readme-example-static` 应 PASS（建议加在检查执行的集成测试；施工时按复用搜索找现有入口）。模型把检查写成只认 README.md 的 `git status` 也是诱因；如果平台不打算过滤 `.workbench`，模型侧至少要把检查收窄成 `git status -- README.md`。但根因仍是平台自己的改动范围读口和检查的 git 视图对 `.workbench` 口径不同：同一个目录，读改动范围时被排除，跑检查时又变成未跟踪项。

**平台（次，通道缺口）。** `MVP-BEHAVIOR.md:244` 规定“没有参谋可问时问人”；目标没有参谋/秘书线时，执行者不能直接问人，检查环境的问题无法升级成卡。补一条执行者→人的上报通道，或在建目标时就保证有可用的上报线；具体形状要 lead 定，因为这会动接口。

**驱动（次）。** `iter.mjs:52` 传 `check:'seed-ready'` 或 `returnOnDecide:true`；`waitGoal` 的 ended 不应默认落到首个未判判据，应抛场景级 `Abort('not-run')`，让 `ideas` 保持 uncovered。这样即使平台停，报告也不会把“没有请求过 ideas”记成 ideas fail。

### 否定证据

- iteration 段共 49 行 HTTP（`grep -c '"scenario":"iteration"'` → 49），`requests/submit` 只有 1 次（`grep -c 'requests/submit'` → 1），`plans/apply` 0 次；`:55` 的 ASK_IDEAS 没有发出。
- 账本 #200 的 `operation=requeue`、`code=no_new_basis`、`matchedRequeueRef=a0762881`、`basisDigest=58bd1190…`、`sourceDigest=1bb3021a…` 与第 1 次相同；两个 Run 的检查结果 #161/#199 都是 `readme-example-static` FAIL、`node-test` PASS。
- 快照内复跑 `git status` 三段：clause1/2=0，count=1（`.dsh-scratch/s2-iter/` 有复现脚本与输出）。

## intervention

### 现象与时间线

20:59:50 采用计划，t1/t2/t3 依次跑完（约 21:00:54）。21:00:13.058 发直接干预（`http.jsonl:356`），21:00:27 回复，21:00:36.865 被 Run `05c1fcf6` 接受，33ms 后 Run 结束。21:00:56.267 GoalPhase `COMPLETED`。

- 21:01:01.989 **pause**：`core/goals/control`，commandId `goals-control-mwv6j15x-48`，http 400，`rejected`，`invalid`，reason “the Goal is completed for its active Plan; it has no work to stop”，无 refs（`http.jsonl:359`）。
- 21:01:01.992 发 PAUSED_TEXT：`messages/send`，commandId `messages-send-mwv6j160-49`，`committed`，消息 `c20e…`（`:360`）。
- 21:01:15.477 平台开 `intervention_new_goal`；21:01:28.534 秘书答新目标卡（events 386–399）。
- 21:01:59.368 `messages/view` 读到 `offerable`（`:395`，`repeat:190`，lastAt 21:32:02.026）。
- 21:01:59.373 **resume**：`goals-control-mwv6k9fx-50`，http 409，`busy`，“the Goal is not paused”（`:361`）。
- 之后 30 分钟只有轮询；21:32:02 超时，21:32:02.537 场景结束。

### 根因

驱动在 Goal 已经 `COMPLETED` 之后 5 秒才发 pause。平台按 GOAL-04 的拒绝顺序（`goal-machine.ts:558/590/593`；`STATE-MACHINES-SPEC.md:372-373`、`:433`）正确回 `invalid`。驱动不检查 `paused.status`，继续发 PAUSED_TEXT、发 resume；resume 因为 Goal 从未暂停而回 `busy: not paused`。那条“暂停中”的消息实际按“已完成 Goal 的人消息”走了 `intervention_new_goal`（`intervention.ts:244-247`、`:521-532`；`MVP-BEHAVIOR.md:377`），等人工确认新 Goal，所以“恢复后 30 分钟没有收尾”是必然的。

`offerable` 不是“暂停没生效”的证据：消息被收下后排队是正常态（`session-message.ts:135`、`communication-contracts.ts:199-212`）；真正的暂停闸门是 `message-machine.ts:1042-1043` 的 `reason='paused'`。本次 Goal 从未暂停，所以这条闸门没有参与。

另有一个驱动隐患：`int.mjs:112` 的 `control()` 恒发 `GoalPhase@0`，实际 GoalPhase 是 `@1`；本次先被 completed 检查挡下，没比 pin，但换成另一个已暂停/未完成的目标就会 `revision_conflict`。

### 分类与改法

**驱动（主，平台无违反）。** `int.mjs:215-229`：
1. pause 提前到 `:134-139` 看到 running Run 后立即发（至少早于 `:220` 的 sleep 60 秒）；发前读 `goals/display` 确认 `phase` 是 active且有 running Run，不要赌长 Goal 还活着。
2. `:112` 用 `tasks/query` 的 completion 取 GoalPhase 实际 revision（`E3-UI-ITEMS.md:136`），不要固定 0；`http.write` 只对 `revision_conflict` 自动重钉重试，`invalid` 不重试。
3. `:215-229`：`paused.status !== 'committed'` 时记 `uncover('paused-queues','not-run', code+reason)` 并跳过；不发 PAUSED_TEXT、不 resume、不等 30 分钟；resume 只在 pause committed 后发。
4. 测试行：`int.mjs:214-229` 加“pause 前 Goal 已完成 → not-run”用例；这是驱动测试，不是平台测试。

### 否定证据

- `http.jsonl:359/360/361` 三条命令的 http/status/code/reason 如上；`GoalDesiredStateChanged` 在账本里 0 行（SQL：`SELECT count(*) FROM events WHERE eventType LIKE '%GoalDesiredStateChanged%'` → 0），说明 pause/resume 都没有提交成功。
- 账本 Goal 快照：`revision=2`、`desiredState='active'`、`desiredStateRevision=1`；GoalPhase：`revision=1`、`COMPLETED`、`reducedAt=21:00:56.267`；消息 `c20e…`：`status=pending`、`delivery=queued`、`goalRef=null`；21:01 后 `SessionMessageInputAccepted` 0 行。

## waiting

### second-expiry

**现象。** notes 说“同一追问链实际到期 2 次，第二次已由 expiry 接受；成员之后的 turn 输入写‘第 2 次到期’：false”。

**查清。** 账本里只有 2 次到期：`647b…` 21:37:29.467（第 1 问），`48f4…` 22:10:03.989（第 2 问，`followupOf=null`）。第 1 问的追问 `aa89d3…` 在 21:39:40.815 已被回答、`expiredAt=null`。按 `MVP-BEHAVIOR.md:308` 和 `STATE-MACHINES-SPEC.md:3661`，“第 2 次到期”只属**同一问题**的追问链；`48f4` 没有父级到期，`readExpiryCount=1` 是正确的。report 的 note 实际写的是“等待链 647b → 647b”（`checks/notes.md:190`），不是 647b 与 48f4 并链。

真因在共享 helper `scripts/acceptance/lib/flows.mjs:1115-1116` 的 `messageRefOf`：它用 `findAll(...)[0]` 取结果里的第一个 SessionMessage；追问的 send 结果里，`followupOf` 的原消息（`647b`）排在本次消息的 `ref`（`aa89d3`）之前，于是 `wait.mjs:167` 把 `chainRefs` 读成 `[647b, 647b]`。`expired=2` 是同一个 `647b` 被数了两次，`second` 也是 `647b` 自己；`secondSaid` 找“第 2 次到期”当然找不到。

**分类。驱动。** 修 `messageRefOf`：取 `values[0].message.ref`，或显式排除 `followupOf` 节点；`chainRefs` 按 messageId 去重。它是共享 helper，`wait.mjs:119` 和 `e09.mjs:131/199` 都用，修一次三处复用。修好后 `second-expiry` 要么按同一问题的真实第二次到期判，要么记 `uncover`；不能再用重复的 647b 充数。平台旁证：保存 `48f4` 的 Run `60c30b52` 是 `crashed`、`continuation=null`（event 256），`workflow.ts:1555-1563` 只认 yielded Run，所以到期不会唤醒；这是另一个缺口，不是本次 fail 主因。


### transfer

**现象。** `waits/dispose` 转交被拒 `invalid waiting_line_live`；第二个问题期限未变。

**查清。** `http.jsonl:459` 21:40:14.821 `core/waits/dispose`，`status=rejected`、`code=invalid`、`reason=waiting_line_live`。规格 `STATE-MACHINES-SPEC.md:3727`：“`transfer` 只在等待的发信线归档、归档中或退役时允许，否则 `invalid/waiting_line_live`”（`message-machine.ts:1305-1330`、`message-forwarding.ts:387-478`）。成员发信线没有归档；最后 Run `98349877` 21:40:04 已结束，但“live”指线未归档，所以平台拒得对。54ms 后归档的是收信秘书线（event 290），不是发信成员线，不满足条件。`wait.mjs:418-422` 只发一次、失败即判 fail；线状态不变，重试也没用。

**分类。驱动。** 先归档/退役成员发信线再 transfer，或者按裁定 Q8 把这一支记 `uncover`。平台不用改。

## E09

### observation-after-pass

**现象。** 采用后观测 `captureId=ca125a3e-78aa-440e-82ca-e9aa294a3636`，检查通过后还是同一个。

**查清。** 规格 `PRODUCT.md:378`：“登记项目后、正式架构采用后各自动抓一次文件级观测图，之后每次正式检查通过后抓”。平台确实每次都发 capture：events 269/282/300/314 的 `trigger=check_passed`；但 8 次全部失败，错误是 `invalid … observed architecture body has an invalid architecture snapshot`（`architecture-service.ts:1166`、codec `:442`），包括 adoption 后 66/89、revise 325/326、startup 348/349/350/351。首要输入是 adopted catalog 的 `tests.paths=["test/"]`（event 64/323）；`architecture-source.ts:69` 和 `workspace-path.ts:24` 拒尾斜杠，`mappingsOf` 原样传（`architecture-catalog.ts:86`）。

**分类。平台。** 违反 `PRODUCT.md:378`。最小改法：在 `mappingsOf`/采用时把 `test/` 规范成 `test`，或在采用时直接拒绝带尾斜杠的 path；把已有的 codec 拒绝记下来/报出来（`architecture-record-codecs.ts:442` 已经在拒非法 snapshot，`architecture-service.ts:1165` 已经调 `decodeObservedArchitectureBody`），不要加第二道形状校验。测试行：catalog `paths=['test/']` 时 capture 成功并换新 `captureId`（建议加在架构 capture 的集成测试；文件待施工时复用搜索确认）。

### adviser-explains

**现象。** report 说：收到上报的参谋轮 1 个；最终答复或 `ask_person`/`notify_person` 正文同时点到 `api.js` 和 `report.js` 的：无。

**查清。** 上报 `session-message-f69a…` 20:46:01.473 由执行者发参谋，20:46:11 开 intervention-planning `19511…`；轮输入含 `f69a` 和 `api.js`/`report.js`（kernel `89503e8d` pos 54；`model-calls.jsonl:62-72`）。`ask_person` 正文只写 `api.js`（pos 66，20:46:22），但轮 final 20:46:41.546 写了两者（pos 89），pos 90 `run.completed` 的 `finalMessageId` 就是它。`turnsOf` 的 `final` 能取到，不是空的。

真因是 `e09.mjs:89-93` 在 `waitGoal(... returnOnDecide:true)` 返回后只取一次 `turnsByDuty` 快照；`waitGoal` 在 20:46:22.340 人答卡时就返回了（`notes.md:86`），20:46:41 的 final 轮不在 `received` 里，所以 `explained` 为空。

**分类。驱动。** 判 `adviser-explains` 前重读参谋线的 `turnsByDuty`/`sessionTurns`（等 report 的答复轮），或按 `report.view.message.response` 的答复轮取 final；`explainTexts` 不用改。平台已经发布答复，模型已经写全。

### 否定证据

- E09 段 71 行 HTTP（`grep -c '"scenario":"E09"' checks/http.jsonl` → 71）；`plans/apply` 0 次、`messages/send` 0 次（同上过滤后 `grep -c` → 0/0）。observation 的 capture 失败事件 8 条（events 269/282/300/314 等），`captureId` 始终 `ca125a3e`。
- 参谋轮的 final 存在（pos 89）；report 的 `explained` 为空是 `turnsByDuty` 快照早于 final 轮，不是平台没发布。

## E08、E08b 与叫醒轮

### E08 switch

**事实。** 最终候选 `proposal-2ad6` 的 `draft.tasks`：`t-sub=active`、`o-sub.taskIds=[t-sub]`；采用版 `bf1f6` 的 `dispositionRecord.entries` 只有 `t-accept→superseded`，没有 sub。账本 `QueryJob 1f838245`/`krun-6822` 有 8 次 `submit_plan_round` 试取消/替代 `t-sub`，全部被 `plan-validation.ts:828-837` 拒（`o-sub` 没有 active required carrier）；第 9 次保留 `t-sub` active 才过。候选记录只有 2 条且无 cancelled，**不是采用时丢失**。驱动 `e08.mjs:262-265` 读 adopted plan 的 `dispositionRecord`，没有条目判 fail，判得对；`e09.mjs:225-244` 的 adopted 版本查找也已正确实现。

**分类。模型。** 轮 `krun-6822`（QueryJob `1f838245`）拿到首版计划、改需求“换掉 sub → div、mul 保留”和现有义务；规格 `STATE-MACHINES-SPEC.md:535-537` 的 disposition 语义和 `:563` 的“改范围＝替代 + 新增载体”，`o-sub` 要保留并接收 `t-div`，`t-sub` 只改 disposition；模型没找到这个配方，8 次提交都被 `plan-validation.ts:828-837` 拒，最后保留 `t-sub` active。改法：skill/提示词加一段“有痕任务替代/取消”的配方和自检；测试行 `A2-disposition-change.test.ts`：替代一个已跟踪任务后，旧任务 `cancelled`、旧 obligation 的 taskIds 含新任务、采用版 `dispositionRecord` 有该条。`hold-before-adopt` 这次没走到（sub 先被领），驱动记 not-run 正确，不判。

### E08b

**事实。** 改需求提交 `http.jsonl:501` 21:41:26.691；QueryJob `0212` 21:41:26 开跑；模型 21:41:44 只交 prose `submit_secretary_answer`，没有调 `submit_plan_round`；平台 21:41:49.324 发 `invalid_plan` 通知，计划候选仍只有首版。`plans/request-candidate` 21:41:45.508 起 `repeat:187` 到 22:11:53.821（`http.jsonl:540`），`plans/apply` 0 行；30 分钟超时是因为候选从未产生，不是采用晚。

**分类。模型（主）+ 驱动（次）。** 轮 `0212`（`session-edf`/`krun-eab714`）该调 `submit_plan_round`（如果该轮实际没有挂这个工具，则应改判平台工具挂载；账本只看到它用了 `submit_secretary_answer`，没有逐项工具清单）；skill 要写明“声称已交候选不算，必须调工具”。驱动 `e08b.mjs:113-115` 的 `waitChangeCandidate` 应在末轮非 plan / 收到 `invalid_plan` 时立即结束；超时后 `stop-delivered`、`safe-point-end`、`adopt-after-end` 三条都应记 not-run，`adopt-after-end` 不该判 fail（没有采用发生）。

### 叫醒轮 0 个

**这是驱动数错，不是真的 0。** `run.mjs:214` 判 `turn.runId.startsWith('intervention-planning-')`，但 `sessions/history` 的 `turn.runId` 是 Kernel 的 `krun-…`（`flows.mjs:900-930`），不是 QueryRun 的 `intervention-planning-run-…`。按账本 `QueryJobSubmitted` 且 `aggregateId LIKE 'intervention-planning-%'` 统计，实际 13 轮：E08 1、E09 2、E12 1、iteration 2、intervention 2、waiting 3、E08b 2；E05/E06 0。只回“收到”的 1 个（waiting `132fc967`，成功工具只有读类和 `run_readonly_command`）。改法：用 `sessions/queries`/`queries/read` 把 `queryJobId` 映射到 `executionState.entry.kernel.runId` 再数 turn；`report.mjs` 的文案不用改。

SQL：`SELECT COUNT(DISTINCT aggregateId) FROM events WHERE eventType='QueryJobSubmitted' AND aggregateId LIKE 'intervention-planning-%'`。

## 说不清的

1. **E05 的最小守卫位置**：`execution-inputs.ts:296/438` 加 `create_member` 条件是本报告的建议，但它会让所有 `pick-suggest:` 都依赖工具集；是否应改在 `query-preparation.ts` 的开轮侧，需要 lead 定。另：20:06:33 的 CoreOperation 是否叫醒过、`respond_session_message` 是否真的挂载，只能从“跳过条件未触发”反推，快照没有直接的工具清单；24h 到期路径也没验。
2. **iteration 第一轮的检查环境**：第 1 轮 FAIL 的原因由第 2 轮实测 + 快照复现推得，第 1 轮的检查环境没有直接留证；停时 `open=0`，但 `result.json` 末态 `waitingAnswer=5`，这 5 张卡的种类/出现时刻没有公开记录；无参谋可问时该由哪条入口问人（`MVP-BEHAVIOR.md:244` 只说“问人”，没说执行者工具/卡的具体形状）没有更细的规格。
3. **E08 的替代配方**：建议的“`t-sub` cancelled + `o-sub` 原样 + `t-div` 加入 `taskIds`”是否能过 `plan-validation` 没有实测，模型没有这样交；施工/写 skill 时要先单跑这一条。
4. **E08b 的工具挂载**：`submit_plan_round` 是否在该轮工具里没有逐项核；账本只看到它用了 `submit_secretary_answer`。若没有挂，则改判平台工具挂载。

## 附：只读查询与证据位置

- 账本副本：`.dsh-scratch/s1-e05/`、`s2-iter/`、`s3-int/`、`s4-wait-e09/`、`s5-e08/`；原库在 `projects/<场景>/.git/workbench/projects/<id>/ledger.sqlite`，只读复制后查询。
- HTTP：`.dsh-ref/p6/report/checks/http.jsonl`（行号按文件）；模型请求：`checks/model-calls.jsonl`；逐条判据：`checks/notes.md`；命令：`checks/commands.txt`。
- 关键规格：`docs-lead/MVP-BEHAVIOR.md:308`、`:310`、`:377`；`docs-lead/PRODUCT.md:378`；`docs-lead/refactor/STATE-MACHINES-SPEC.md:372-373`、`:433`、`:535`、`:566`、`:1032`、`:1211`、`:3661`、`:3727`；`docs-lead/refactor/HANDOFF.md:3268`。
- 关键代码：`src/business/workflow/workflow.ts:2141-2148/2653/3012-3018`；`src/core/agent-runtime/query-preparation.ts:88-101`；`src/core/agent-runtime/execution-inputs.ts:296/438`；`src/core/work-graph/state/message-machine.ts:1058-1059/1185-1194`；`src/core/work-graph/tasks/overlap-gates.ts:455-468`；`src/core/work-graph/state/task-failure.ts:959-960`；`src/core/work-graph/model/plan-validation.ts:828-837`；`src/core/architecture/architecture-service.ts:1166`；驱动 `scripts/acceptance/run.mjs:214`、`iter.mjs:52`、`int.mjs:112/215-229`、`wait.mjs:167-182/418-422`、`e09.mjs:89-93/180`、`e08b.mjs:113-115`；共享 helper `scripts/acceptance/lib/flows.mjs:1115-1116` 的 `messageRefOf`（`wait.mjs:119`、`e09.mjs:131/199` 都用）。
