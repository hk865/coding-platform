# G6 notes 2026-11-25（运行号 g6-2026-11-25-791056bc）

## 逐场景判据

### E05：fail

- C 行：C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1010858（含缓存命中），输出 22348，缓存命中 849920，Query 请求 17。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| overlap | C-182, C-183, C-217 | fail | the platform did not do it: stalled: no change for 32 min, nothing in flight (last seen: goal phase CHANGE_PENDING, cause change_pending; driver waiting_for_reply, wait reason the verification round chain head has an executing check; not advancing; plan_candidate_waiting: no_review_line) |
| gate | C-185 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase CHANGE_PENDING, cause change_pending; driver waiting_for_reply, wait reason the verification round chain head has an executing check; not advancing; plan_candidate_waiting: no_review_line) |
| paths | C-185, C-217 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase CHANGE_PENDING, cause change_pending; driver waiting_for_reply, wait reason the verification round chain head has an executing check; not advancing; plan_candidate_waiting: no_review_line) |
| kept | C-185 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase CHANGE_PENDING, cause change_pending; driver waiting_for_reply, wait reason the verification round chain head has an executing check; not advancing; plan_candidate_waiting: no_review_line) |
| single-occupancy | C-71 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase CHANGE_PENDING, cause change_pending; driver waiting_for_reply, wait reason the verification round chain head has an executing check; not advancing; plan_candidate_waiting: no_review_line) |
| convention | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase CHANGE_PENDING, cause change_pending; driver waiting_for_reply, wait reason the verification round chain head has an executing check; not advancing; plan_candidate_waiting: no_review_line) |
| duplicates | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase CHANGE_PENDING, cause change_pending; driver waiting_for_reply, wait reason the verification round chain head has an executing check; not advancing; plan_candidate_waiting: no_review_line) |
| reviewer | C-208, C-218 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase CHANGE_PENDING, cause change_pending; driver waiting_for_reply, wait reason the verification round chain head has an executing check; not advancing; plan_candidate_waiting: no_review_line) |
| name-different | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase CHANGE_PENDING, cause change_pending; driver waiting_for_reply, wait reason the verification round chain head has an executing check; not advancing; plan_candidate_waiting: no_review_line) |
| name-same | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase CHANGE_PENDING, cause change_pending; driver waiting_for_reply, wait reason the verification round chain head has an executing check; not advancing; plan_candidate_waiting: no_review_line) |
| temporary | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase CHANGE_PENDING, cause change_pending; driver waiting_for_reply, wait reason the verification round chain head has an executing check; not advancing; plan_candidate_waiting: no_review_line) |
| line-choice | C-73, C-191 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase CHANGE_PENDING, cause change_pending; driver waiting_for_reply, wait reason the verification round chain head has an executing check; not advancing; plan_candidate_waiting: no_review_line) |

- stopped: not-run: stalled: no change for 32 min, nothing in flight (last seen: goal phase CHANGE_PENDING, cause change_pending; driver waiting_for_reply, wait reason the verification round chain head has an executing check; not advancing; plan_candidate_waiting: no_review_line)
- goal-confirm:goal.confirmDraft:aeded34a75c3f17ec48fc5a317acc372e8885c7f229b8f6bca3be2babbf6bd77 (CHANGE_PENDING): pause because E05 ended: committed

### E06：uncovered

- C 行：C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223；自治档 `after_plan_confirmation`；provider `-` / `-`。
- 用量：输入 0（含缓存命中），输出 0，缓存命中 0，Query 请求 0。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| handoff | C-219 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| successor-input | C-75, C-209, C-219 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| successor-frontier | C-75 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| no-restatement | C-209 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| excluded-path | C-209 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| same-task-new-run | C-135 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| history-continuity | C-106, C-194 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| restart-running | C-149 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| restart-paused | C-151 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| archive | C-219 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| hand-or-drop | C-223 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| wake | C-68, C-181 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |

- stopped: not-run: E05 left no project/work line to continue

### E08：fail

- C 行：C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210；自治档 `every_step`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1922073（含缓存命中），输出 26144，缓存命中 1498496，Query 请求 22。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| autonomy-born | C-133a | pass | 草稿自治 every_step；Goal 生在版本 1，采用后读到 every_step |
| confirm-only-latest | C-47 | pass | 同一草稿换 commandId 再确认：rejected revision_conflict |
| person-adopts | C-46, C-52 | pass | 人确认之前 goals/list 里没有这个 Goal（0 个旧 Goal）；首方案由人 initialization/adopt |
| first-adoption | C-63, C-62 | pass | 采用回执 plan initial-plan-2997e6ce367443715e3b3148c938b46d；Goal 指针 {"aggregateType":"PlanRevision","projectId":"0c01db2452744b591b2cb72d414d68ed","planId":"initial-plan-2997e6ce367443715e3b3148c938b46d"} |
| hold-before-adopt | C-210 | uncovered (not-run) | sub 在 mul 之前先被领了（提交改需求时 sub 已有 1 个 Run），“sub 可领、没开工时暂缓”这一支没走到 |
| versions | C-210 | fail | the platform did not do it: the platform stopped: no_new_basis on task-div |
| switch | C-210 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on task-div |
| old-evidence | C-210 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on task-div |
| required-cancel | C-210 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on task-div |
| autonomy-later | C-126 | uncovered (not-run) | 草稿本来就是 every_step，这次没有中途改档 |
| control-pins | C-116, C-118 | pass | 只钉 Goal 的暂停：rejected invalid |

- first plan initial-plan-2997e6ce367443715e3b3148c938b46d: sub = task-sub，mul = task-mul
- 提交改需求时：mul 0 个 Run（-），sub 1 个 Run；sub 的 dispatch.claimableNow null
- the person selected idea 1 of 2 on the change: 彻底不要 sub：删掉 calc.js 里的 sub，换成 div 任务
- node review task-sub (calc.js, test/sub.test.js): committed
- node review task-mul (calc.js, test/mul.test.js): committed
- requeue card task-div (after Run bd92ac91-a8f9-4ce8-bbb4-bc51ff799714): committed
- requeue card task-div (after Run 923a9e25-14fd-4b27-a39e-5d813c4904fb): committed refused {"ref":{"aggregateType":"TaskReworkRefusal","projectId":"0c01db2452744b591b2cb72d414d68ed","goalId":"goal-confirm:goal.confirmDraft:35420966b2d282fe31d0ca141da1758e388bea6c40b4dede95d3899828498b4a","taskId":"task-div","operation":"requeue","subjectId":"923a9e25-14fd-4b27-a39e-5d813c4904fb"},"revision":1,"schemaVersion":1,"task":{"projectId":"0c01db2452744b591b2cb72d414d68ed","goalId":"goal-confirm:goal.confirmDraft:35420966b2d282fe31d0ca141da1758e388bea6c40b4dede95d3899828498b4a","taskId":"task-div"},"afterRunRef":{"aggregateType":"Run","projectId":"0c01db2452744b591b2cb72d414d68ed","goalId":"goal-confirm:goal.confirmDraft:35420966b2d282fe31d0ca141da1758e388bea6c40b4dede95d3899828498b4a","runId":"923a9e25-14fd-4b27-a39e-5d813c4904fb"},"subjectRoundRef":{"aggregateType":"VerificationRound","projectId":"0c01db2452744b591b2cb72d414d68ed","workspaceId":"b12345bbd75eb8aa62b960a445ad452a","goalId":"goal-confirm:goal.confirmDraft:35420966b2d282fe31d0ca141da1758e388bea6c40b4dede95d3899828498b4a","taskId":"task-div","runId":"923a9e25-14fd-4b27-a39e-5d813c4904fb","roundId":"a571455f-269e-4f72-8b87-48da5f961e6f"},"failureClass":"check_failed","code":"no_new_basis","reason":"no new basis: same failure, source, plan as TaskRequeue bd92ac91-a8f9-4ce8-bbb4-bc51ff799714; supply new input or change the method","basisDigest":"9ec1df55d53d8e2bb36d0df81aa6cea33a6403d7e7e90ac4bf078612e109f095","source":{"workspaceRevision":1,"sourceDigest":"62eaad6f43751089f14564bab3bc848b23f0b82ccbf96c2c8a82041af2e1297d"},"matchedRequeueRef":{"aggregateType":"TaskRequeue","projectId":"0c01db2452744b591b2cb72d414d68ed","goalId":"goal-confirm:goal.confirmDraft:35420966b2d282fe31d0ca141da1758e388bea6c40b4dede95d3899828498b4a","taskId":"task-div","afterRunId":"bd92ac91-a8f9-4ce8-bbb4-bc51ff799714"},"requestedBy":{"kind":"human","id":"g6-person"},"refusedAt":"2026-11-25T10:00:57.106Z","goalEndedRunsAtRefusal":4,"configurationRevision":null}
- stopped: not-run: the platform stopped: no_new_basis on task-div
- goal-confirm:goal.confirmDraft:35420966b2d282fe31d0ca141da1758e388bea6c40b4dede95d3899828498b4a (NEEDS_DECISION): pause because E08 ended: committed

### E09：uncovered

- C 行：C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 4201360（含缓存命中），输出 111991，缓存命中 3419136，Query 请求 79。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| executor-reports | C-185, C-211 | pass | 执行者上报 session-message-48cf42671e980c3350286e6b5a4f98d3fdf7757477aacca5ec4bad4f90093488（要回复的 send_session_message）：发件线 session-91cbc373db8bf683dad6f862da8c760668717b8a124db3dc9c81d928891cb86b（work_run）→ 收件线 session-1a4eb7a43ad0c20e13e0b35c30da6ef336225fa68ca9c5eaeba2eecca8f1d47f（参谋），needsReply true，answeredBy line；还没有答复；参数 {"needsReply":true,"recipient":{"projectId":"ececc734afe9e910e19386cef63a220a","sessionId":"session-1a4eb7a43ad0c20e13e0b35c30da6ef336225fa68ca9c5eaeba2eecca8f1d47f"},"taskRef":{"goalId":"goal-confirm:goal.confirmDraft:ceca2403a02a171d7368580cdc237c17a76ce5480f1f766c22c2f2d560742684","projectId":"ececc734afe9e910e19386cef63a220a","taskId":"B"},"text":"B（src/report.js: monthOf）已完成，node --test 10/10 通过（tests 10, pass 10, fail 0）。\n\n做了什么：\n- src/report.js 新增 import { parseDate } from './api.js'; 导出 monthOf(text)，返回 \"YYYY-MM\"。内部私有 toDateParts(value) 做局部适配：parseDate 现返回 Date（UTC 午夜），取 getUTCFullYear/getUTCMonth+1/getUTCDate 得到 {y,m,d}；同时兼容将来若改为 {y,m,d} 的情况。report.js 内没有任何 YYYY-MM-DD 文本解析、没有 new Date(text)/Date.parse(text)。\n- 未修改 src/api.js 的签名或返回类型（该文件全部改动来自 A，我未触碰）。\n- 复用的现成件：parseDate（src/api.js），无新建共享件。\n\n新增文件：test/report.test.js（node:test，5 个用例：导出、正常月份、单月补零、错误传播、以及静态断言 report.js 从 './api.js' 导入 parseDate 且不自行解析）。\n\n工作区 git 状态：M src/api.js（A 的改动）、M src/report.js、?? test/api.test.js（A）、?? test/report.test.js，均在本任务范围内。\n\n冲突（需人裁决，已记 note 912b8fa8-937d-4130-9813-32ee8640921a，挂在 report 模块锚点，状态 open）：\n- 对象：parseDate 的返回类型。A 要求 Date（现状，只接受 YYYY-MM-DD）；B 需要 {y,m,d}。\n- 影响：改 Date→{y,m,d} 会让 A 的调用方失去 Date 语义（getTime、比较、toISOString、时区）；保持 Date 则所有消费方要就地适配（B 已这么做）。\n- 两种消解：(1) 保持 Date，消费方各自适配；(2) 改 parseDate 返回 {y,m,d}，另设返回 Date 的函数——属 api 模块接口变更，需更新接口约定，B 不做。\n- 现状无阻塞，B 的验收（B-static / B-dynamic）在 Date 合同下已满足；若裁决反过来，report.js 的适配分支会直接生效，但需 api 负责人按新约定调整。","wake":true} |
| adviser-explains | C-211 | uncovered (not-run) | 上报 session-message-48cf42671e980c3350286e6b5a4f98d3fdf7757477aacca5ec4bad4f90093488 发给了参谋线 session-1a4eb7a43ad0c20e13e0b35c30da6ef336225fa68ca9c5eaeba2eecca8f1d47f，但参谋的 2 个轮的输入里都没有它：参谋还没处理这条上报 |
| person-decides | C-211, C-62 | uncovered (not-run) | 参谋没有解释这条上报（uncovered），人对它的决定和新版本这两环没有发生 |
| new-version | C-211, C-55 | uncovered (not-run) | 参谋没有解释这条上报（uncovered），人对它的决定和新版本这两环没有发生 |
| report-after-dispatch | C-185, C-211 | uncovered (not-run) | 同目标没有 agent 派活落实（任务卡 dispatch.request 没有 applied 的），这一支没走到 |
| diagnosis-reverify | C-211 | uncovered (not-run) | 2 个检查轮里没有一轮的重验以消息为依据（reverify.newInputRefs 没有 session_message），这一支没走到（可选） |
| formal-change | C-212 | pass | architecture/revise committed  ；目录版本 2 |
| drift | C-212, C-89 | pass | compare-formal 5 条 finding；带路径的：package.json, README.md, src/report.js, test/api.test.js, test/report.test.js |
| observation-after-adopt | C-65 | pass | 采用后观测 {"aggregateType":"ObservedArchitecture","projectId":"ececc734afe9e910e19386cef63a220a","workspaceId":"70393474b6d1c6f4d93f4cfeed258942","captureId":"bf1d299b-d9b7-4dda-85c0-a1a56c53ee17"} |
| observation-after-pass | C-98 | pass | 观测：采用后 {"aggregateType":"ObservedArchitecture","projectId":"ececc734afe9e910e19386cef63a220a","workspaceId":"70393474b6d1c6f4d93f4cfeed258942","captureId":"bf1d299b-d9b7-4dda-85c0-a1a56c53ee17"} → 现在 {"aggregateType":"ObservedArchitecture","projectId":"ececc734afe9e910e19386cef63a220a","workspaceId":"70393474b6d1c6f4d93f4cfeed258942","captureId":"82a95f52-d51f-45df-bbc3-2bf6ebc11f26"} |
| rounds | C-93, C-95, C-218 | pass | satisfied 任务的最新轮：A PASS/gaps 0, B PASS/gaps 0 |
| uncovered-round | C-99 | uncovered (not-run) | 这次没有出现缺覆盖（INCONCLUSIVE）的检查轮 |

- E09 Goal ended COMPLETED
- 8E contact 层：uncovered (8E optional)（只记在这里，不进 uncovered[]；9-start-rulings.frozen.md:966-967）

### E12：fail

- C 行：C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1001667（含缓存命中），输出 11337，缓存命中 793984，Query 请求 17。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| reads-quiet | C-36 | pass | QueryRun 3→3，输入 382573→382573，changesHead h0000001096→h0000001096 |
| graph-cards | C-88, C-89 | pass | goal children 1，find 5，path 卡 有 |
| raw-history | C-42, C-157 | pass | 线的原历史 50 条，Run 历史 49 条 |
| completion-chain | C-104 | pass | 检查轮卡 2 张，有非空 evidenceRefs：true |
| restart-state | C-145, C-215 | pass | 重启后旧 Goal COMPLETED，计划 initial-plan-6e17485450fcd323ed4fa6565509736f，Run 1/1 |
| reconcile | C-146 | pass | host/reconcile-report：lease owned |
| redrive-sets | C-155 | pass | 旧 Goal 的 causes：[] |
| new-goal | C-114, C-158 | fail | the platform did not do it: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g2 has no ended ordinary producer Run yet) |
| history-reuse | C-220 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g2 has no ended ordinary producer Run yet) |
| stale-premise | C-220 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g2 has no ended ordinary producer Run yet) |
| replay | C-147 | pass | 同一 flowId 两次 driver-start：ready/ready，state running/running |
| wait-registry | C-207 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g2 has no ended ordinary producer Run yet) |

- restart: SIGINT, exit 0 after 1195 ms
- goal-confirm:goal.confirmDraft:7fc83ceabc56091abc4a232d79c46a4e4ee21195ee5af679682370310f125e15: the person selected idea 1 of 3 (确定：farewell(name) 返回 "goodbye <name>"，另建独立测试文件)
- stopped: not-run: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g2 has no ended ordinary producer Run yet)
- goal-confirm:goal.confirmDraft:7fc83ceabc56091abc4a232d79c46a4e4ee21195ee5af679682370310f125e15 (RUNNING): pause because E12 ended: committed

### iteration：pass

- C 行：C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1351471（含缓存命中），输出 18952，缓存命中 1054464，Query 请求 26。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ideas | C-108 | pass | 3 个思路，目标卡草稿 0 |
| select | C-109 | pass | select-idea queued；下一轮输入提到所选：true |
| candidate | C-110 | pass | 候选 plan-proposal-d30586b79d75db4305e361fc11780112（candidate） |
| what-changed | C-213, C-110 | pass | 第二轮回答说明改动：true；新候选 plan-proposal-1d54c99df9bb246aa0a5d2e7212caa78，前一版 {"proposalRef":{"aggregateType":"PlanProposal","projectId":"f5de3e4477ce7fa4f49fc5b342be4ba4","workspaceId":"92930992c1f035b6aea4ed598ed686d1","proposalId":"plan-proposal-d30586b79d75db4305e361fc11780112"},"revision":2} |
| per-request | C-111 | pass | 采用第一请求的候选 committed；第二请求候选 plan-proposal-a5c7b2c58cc13acd0e2e4c5c11f2e123 现在 stale |
| why | C-112, C-226 | pass | 追问后候选不变：true；回答 1166 字 |
| continues | C-105 | pass | 同一请求 3 轮，秘书 Session session-ff4a9dc221da63eb7d51929efdd147d4017230ffd65371a504b1ea72c5c11084 |
| request-goal | C-107 | pass | 请求记的目标 goal-confirm:goal.confirmDraft:ce1a89a59d423a8db1630ce44fd4a04b8184bc892d2fae423247917794894185 |
| cards-ask | C-113 | pass | 秘书线的 turn 输入带 ## Cards：true |
| multi-round | C-194 | pass | 后续轮的回答接上前面改过的内容（process.argv） |

- goal-confirm:goal.confirmDraft:ce1a89a59d423a8db1630ce44fd4a04b8184bc892d2fae423247917794894185 (RUNNING): pause because iteration ended: committed

### intervention：fail

- C 行：C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 783319（含缓存命中），输出 11898，缓存命中 591744，Query 请求 14。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ask-copy | C-198 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase BLOCKED, cause no_dispatchable_work; driver waiting_for_reply, wait reason plan_refine_pending: the refinement round is already committed; plan_candidate_waiting: no_review_line) |
| delivery-states | C-189, C-192 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase BLOCKED, cause no_dispatchable_work; driver waiting_for_reply, wait reason plan_refine_pending: the refinement round is already committed; plan_candidate_waiting: no_review_line) |
| busy-original-words | C-189, C-199 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase BLOCKED, cause no_dispatchable_work; driver waiting_for_reply, wait reason plan_refine_pending: the refinement round is already committed; plan_candidate_waiting: no_review_line) |
| continue-no-planning | C-199 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase BLOCKED, cause no_dispatchable_work; driver waiting_for_reply, wait reason plan_refine_pending: the refinement round is already committed; plan_candidate_waiting: no_review_line) |
| planning-when-idle | C-199, C-200 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase BLOCKED, cause no_dispatchable_work; driver waiting_for_reply, wait reason plan_refine_pending: the refinement round is already committed; plan_candidate_waiting: no_review_line) |
| claim-once | C-199 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase BLOCKED, cause no_dispatchable_work; driver waiting_for_reply, wait reason plan_refine_pending: the refinement round is already committed; plan_candidate_waiting: no_review_line) |
| four-endings | C-201, C-202, C-203 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase BLOCKED, cause no_dispatchable_work; driver waiting_for_reply, wait reason plan_refine_pending: the refinement round is already committed; plan_candidate_waiting: no_review_line) |
| review-packet | C-199 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase BLOCKED, cause no_dispatchable_work; driver waiting_for_reply, wait reason plan_refine_pending: the refinement round is already committed; plan_candidate_waiting: no_review_line) |
| completed-goal | C-114 | fail | the platform did not do it: stalled: no change for 32 min, nothing in flight (last seen: goal phase BLOCKED, cause no_dispatchable_work; driver waiting_for_reply, wait reason plan_refine_pending: the refinement round is already committed; plan_candidate_waiting: no_review_line) |
| paused-queues | C-197 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase BLOCKED, cause no_dispatchable_work; driver waiting_for_reply, wait reason plan_refine_pending: the refinement round is already committed; plan_candidate_waiting: no_review_line) |

- stopped: not-run: stalled: no change for 32 min, nothing in flight (last seen: goal phase BLOCKED, cause no_dispatchable_work; driver waiting_for_reply, wait reason plan_refine_pending: the refinement round is already committed; plan_candidate_waiting: no_review_line)
- goal-confirm:goal.confirmDraft:a22408ba7fb79db780c6d423a4a4078a70f26230efad673cbba1bbb6fa20d2be (BLOCKED): pause because intervention ended: committed

### waiting：uncovered

- C 行：C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1950905（含缓存命中），输出 27590，缓存命中 1617280，Query 请求 18。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| wait-open | C-188, C-225 | pass | 成员 session-5a82f22005d4f24e5e13e52c63effe757a12a98fbc395e5d024296ec5f819609 的 Work（Run 40195587-80a5-4a20-bd0f-a9ffbe93a3d3）经工具发出等待 session-message-0f0e13ab50ab9f6712de572e3a4ec485df103bc6e68a2b60805156a8d5d70fe1：收信人 session-8886b6ab64aa8431df5992f48f0b938e78513e97bbf3894f8801e9ec1a9f7af7，期限 2026-11-25T11:38:51.949Z，waitAfterSend true；发信的 Run 40195587-80a5-4a20-bd0f-a9ffbe93a3d3 ended/yielded，continuation wait_reply → session-message-0f0e13ab50ab9f6712de572e3a4ec485df103bc6e68a2b60805156a8d5d70fe1 |
| interject-keeps-wait | C-188, C-224 | pass | 插话 session-message-610490d7de2d089ad292acf7895c3162bce283be69d598c8f43b1647ac32808a（sent）：接它的 Run 35c436aa-d4bf-4578-8965-f656cf920698（consumedWait intervention，在 session-5a82f22005d4f24e5e13e52c63effe757a12a98fbc395e5d024296ec5f819609）；原等待 session-message-0f0e13ab50ab9f6712de572e3a4ec485df103bc6e68a2b60805156a8d5d70fe1 open，期限 2026-11-25T11:38:51.949Z（原 2026-11-25T11:38:51.949Z）；新中断通知 成员侧 1 条、秘书侧 1 条 |
| restart-kept | C-170, C-207 | pass | 重启后同一等待：从sessions/facts 的 waits（expired）读到，期限 2026-11-25T11:38:51.949Z（原 2026-11-25T11:38:51.949Z），收信人 session-8886b6ab64aa8431df5992f48f0b938e78513e97bbf3894f8801e9ec1a9f7af7；消费它的接受 expiry → Run a23a44ce-8c9e-40cd-a25e-d72ea1bfbaaa；接续的 Run a23a44ce-8c9e-40cd-a25e-d72ea1bfbaaa consumedWait expiry，messageRef session-message-0f0e13ab50ab9f6712de572e3a4ec485df103bc6e68a2b60805156a8d5d70fe1，originalRun 40195587-80a5-4a20-bd0f-a9ffbe93a3d3（原 40195587-80a5-4a20-bd0f-a9ffbe93a3d3），在 session-5a82f22005d4f24e5e13e52c63effe757a12a98fbc395e5d024296ec5f819609（成员 session-5a82f22005d4f24e5e13e52c63effe757a12a98fbc395e5d024296ec5f819609） |
| expiry-once | C-171, C-190 | pass | expiredAt 2026-11-25T11:39:59.379Z；记下时消费 false；之后由 expiry 消费 |
| second-expiry | C-171, C-190, C-224 | uncovered (env-unavailable) | 等待链已结束（t-wait satisfied，链上 2 条等待都已了结）；第二次到期已记下，但它的 expiry 接受和后继输入还没出现 |
| consumes | C-187 | pass | 等待 session-message-0f0e13ab50ab9f6712de572e3a4ec485df103bc6e68a2b60805156a8d5d70fe1 的接受条目：message:false@2026-11-25T11:42:38.768Z, expiry:true@2026-11-25T11:43:07.988Z（只认一次真实接受消费等待） |
| late-reply | C-224, C-189 | uncovered (env-unavailable) | 等待链已结束（t-wait satisfied，链上 2 条等待都已了结）；到期（2026-11-25T11:39:59.379Z）被消费之后没有回复（回复槽空，也没有接受的回复） |
| reply-first | C-187, C-224 | uncovered (not-run) | 第二个问题 session-message-6afae00b32cd4cb45599a54a769c30aa844ed1180797ae6a8f7737b96e4236af（期限 2026-11-25T12:13:07.922Z）：先到期了（2026-11-25T12:14:03.338Z），没有回复抢先 |
| transfer | C-224 | uncovered (env-unavailable) | 第二个问题 session-message-6afae00b32cd4cb45599a54a769c30aa844ed1180797ae6a8f7737b96e4236af（期限 2026-11-25T12:13:07.922Z）：转交前已到期 |
| disconnect | C-195, C-196 | uncovered (env-unavailable) | 归档前成员线上已没有开着的等待（都已回答或处理），断开无从造出 |
| supply-order | C-172, C-192, C-184 | uncovered (entry-missing) | 供给顺序只在 Kernel 的一次输入里，公开读口不给逐项来源顺序 |

- P6 Q8 插话在第一个等待开着时发出；它让成员线多开了一个 Run（35c436aa-d4bf-4578-8965-f656cf920698），之后的到期链在这之后发生
- 关 Host 时 t-wait 的 Run 仍在跑（35c436aa-d4bf-4578-8965-f656cf920698）：重启后它记中断、按普通重新入队接着做，不是等待的接续
- close and restart: SIGINT, exit 0 after 277 ms
- restart: resumeOnStartup = ask
- 等待链 session-message-0f0e13ab50ab9f6712de572e3a4ec485df103bc6e68a2b60805156a8d5d70fe1 → session-message-60e30e3c3d1073797dbc7f04becc0aa333b6fba2795a09dd67c918afb6a30152；结束方式 chain-over

## 撞墙表

| 时间 | 场景 | 哪一步 | 看到的拒绝原文和理由 | 类别 | 预期 | 建议包 |
|---|---|---|---|---|---|---|
| 2026-11-25T08:35:55.127Z | E05 | tool list_files (call call_iyrfci1w) | invalid_arguments: 工具参数不符合 schema：prefix: Too small: expected string to have >=1 characters; prefix: Use a workspace-relative path | 无理由 | - | 待定 |
| 2026-11-25T08:36:17.224Z | E05 | tool submit_initial_plan (call call_qkmax2vk) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T08:36:24.134Z | E05 | tool submit_initial_plan (call call_k107svq7) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-25T08:37:07.119Z | E05 | tool read (call call_1njfk7g5) | execution_failed: .workbench/modules 不是普通文件 | 无理由 | - | 待定 |
| 2026-11-25T09:11:40.423Z | E08 | tool read (call call-1330999e-d3a1-4341-852e-c1c044d94f82) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-25T09:13:14.714Z | E08 | tool look_graph (call call-56de0d30-ab57-404a-9772-9e2c75d4a7f0) | invalid_arguments: 工具参数不符合 schema：target.ref.goalId: Too small: expected string to have >=1 characters | 无理由 | - | 待定 |
| 2026-11-25T09:17:58.003Z | E08 | tool submit_initial_plan (call call-85159561-6ac4-45b8-bc1a-324089c63a9c) | invalid_arguments: 工具参数不符合 schema：setup.architecture.constraints.0.scope: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-25T09:20:12.366Z | E08 | tool submit_initial_plan (call call-5dc8d976-009d-4ed2-bcad-196a258b9c12) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T09:20:35.996Z | E08 | core/goals/confirm-draft confirm-again-mwvwy4d8-8 | revision_conflict: the draft already created a goal; one card never makes two goals | 协调 | expected | 待定 |
| 2026-11-25T09:20:36.006Z | E08 | core/goals/control goals-control-mwvwy4di-9 | invalid: meta.expected must pin the Goal and its GoalPhase (0 = none stored) | 产品规则 | expected | 待定 |
| 2026-11-25T09:33:08.816Z | E08 | tool edit (call call_01_bu2tbo1vb92dutixxskiusz5) | execution_failed: test/sub.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-25T09:33:47.607Z | E08 | tool edit (call call_00_oyb6makkrccfa12xjw948qdo) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 无理由 | - | 待定 |
| 2026-11-25T09:34:22.064Z | E08 | tool submit_plan_round (call call_00_sqragc2yjhylyiroc9wzohmf) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-25T09:34:37.927Z | E08 | tool submit_plan_round (call call_00_jpknwgtzw0n7x03f14n1g18m) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T09:49:45.588Z | E08 | tool ask_copy (call call_402c451084cf4f55926a5394) | not_found: the requested record does not exist | 无理由 | - | 待定 |
| 2026-11-25T09:52:41.459Z | E08 | tool record_note (call call_2bad44af7ce34364a5c0d913) | invalid_arguments: 工具参数不符合 schema：topic: Invalid input: expected string, received undefined; (根): Unrecognized key: "ancestor" | 无理由 | - | 待定 |
| 2026-11-25T10:06:21.782Z | E09 | tool submit_initial_plan (call call-b0d90fe0-298d-4971-96f7-dc97c8c78d2c) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T10:06:36.180Z | E09 | tool submit_initial_plan (call call-37d4d78c-c08d-4e8e-874e-ed459e62630f) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined; setup.checks.2.kind: Invalid option: expected one of "static"\|"dynamic" | 无理由 | - | 待定 |
| 2026-11-25T10:06:53.496Z | E09 | tool submit_initial_plan (call call-b5c35133-afb6-4d98-bdaf-cdd59b04abd5) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-25T10:07:47.032Z | E09 | tool submit_initial_plan (call call-f8d755c9-b0bb-4bc0-9c8c-e3f753bcba53) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T10:08:16.997Z | E09 | tool submit_initial_plan (call call-7abab6a0-9190-4cb2-99b1-603f85a4b1ba) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "assignments" | 无理由 | - | 待定 |
| 2026-11-25T10:09:50.987Z | E09 | tool read (call call-a53c8394-08e9-4c44-a028-2716840edb6e) | execution_failed: .workbench 不是普通文件 | 无理由 | - | 待定 |
| 2026-11-25T10:10:51.721Z | E09 | tool list_files (call call_00_rrxako4a7ic4e86kik8gtr22) | invalid_arguments: 工具参数不符合 schema：prefix: Too small: expected string to have >=1 characters; prefix: Use a workspace-relative path | 无理由 | - | 待定 |
| 2026-11-25T10:11:10.981Z | E09 | tool dispatch_task (call chatcmpl-tool-babd315b04c3f312) | busy: the Task is in progress; its lease is still held by a running Run | 协调 | - | 待定 |
| 2026-11-25T10:11:11.018Z | E09 | tool dispatch_task (call chatcmpl-tool-9b91ef3a96f97cbd) | busy: the Task is in progress; its lease is still held by a running Run | 协调 | - | 待定 |
| 2026-11-25T10:11:43.761Z | E09 | tool edit (call call-b0ac58cb-9ba6-4e56-9e6c-3946c1bd16bf) | invalid_arguments: 工具参数不符合 schema：expectedRevision: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-25T10:11:43.817Z | E09 | tool edit (call call-375ce493-0de4-497c-8811-7bedde43137b) | execution_failed: test/api.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-25T10:12:06.231Z | E09 | tool submit_plan_round (call chatcmpl-tool-a208252ae374e426) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase"; plan.tasks.3: Unrecognized key: "phase"; plan: Unrecognized key: "schemaVersion" | 无理由 | - | 待定 |
| 2026-11-25T10:13:50.864Z | E09 | tool record_note (call call_5047c6f722cf4c1d979b9f87) | forbidden: only a scribe, the author or the user may change a disposition | 无理由 | - | 待定 |
| 2026-11-25T10:15:12.296Z | E12 | tool submit_initial_plan (call call-08d711e1-a436-4670-881c-d955835f288d) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T10:15:39.403Z | E12 | tool submit_initial_plan (call call-92606bb2-ef4d-44f8-84a7-3c1290783dc7) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-25T10:16:54.502Z | E12 | tool read (call call_00_bhs21kxiu55ugh5krjex82mf) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-25T10:17:17.184Z | E12 | tool read (call call-e8ee5511-001f-4963-9fb0-10a3409fbbaa) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-25T10:17:40.871Z | E12 | tool edit (call call_2a26cb83a8284e8bafc33160) | execution_failed: test/greet.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-25T10:19:47.219Z | E12 | tool query_task_graph (call call_00_3r5fw3wwoquhka7s3jvt2lt5) | execution_failed: the requested plan record does not exist | 无理由 | - | 待定 |
| 2026-11-25T10:19:52.580Z | E12 | tool query_ready_tasks (call call_00_g0i5qq8fmdk6pmuftd2lxi90) | execution_failed: the requested plan record does not exist | 无理由 | - | 待定 |
| 2026-11-25T10:20:03.026Z | E12 | tool submit_plan_round (call call_00_fkfwn1u1jssiqwn4c35xr47c) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase" | 无理由 | - | 待定 |
| 2026-11-25T10:53:37.611Z | iteration | tool submit_initial_plan (call call-3d677431-4084-43c5-a1a0-30fe8bef18e7) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T10:53:53.634Z | iteration | tool submit_initial_plan (call call-3c7648e5-3084-4fab-9526-54c42e4ee6b0) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan: Unrecognized key: "summary"; setup.checks.1.kind: Invalid option: expected one of "static"\|"dynamic"; setup.checks.2.kind: Invalid option: expected one of "static"\|"dynamic" | 无理由 | - | 待定 |
| 2026-11-25T10:54:08.023Z | iteration | tool submit_initial_plan (call call-d9e8b1f7-b0e8-47db-888c-9d5f1fd7a8a0) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T10:54:57.659Z | iteration | tool dispatch_task (call call_00_gn3e1nipl6iu071pk9yafcpr) | busy: the Task is in progress; its lease is still held by a running Run | 协调 | - | 待定 |
| 2026-11-25T10:56:38.886Z | iteration | tool submit_plan_round (call call_00_iixvq5pyizpb8u305zna7mwu) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T10:58:18.518Z | iteration | tool submit_plan_round (call call_e6237c13208b4b6b8130c5b4) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T10:58:32.374Z | iteration | core/goals/control goals-control-mww0g2ly-43 | revision_conflict: the GoalPhase changed since the caller read it | 协调 | - | 待定 |
| 2026-11-25T10:58:40.513Z | intervention | tool list_files (call call_00_cfakbSpnlYD8uU8siKY59919) | invalid_arguments: 工具参数不符合 schema：prefix: Too small: expected string to have >=1 characters; prefix: Use a workspace-relative path | 无理由 | - | 待定 |
| 2026-11-25T10:58:57.398Z | intervention | tool submit_initial_plan (call call_00_Ndl9SzrXPF6MbX8nSvvk5460) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T10:59:42.356Z | intervention | tool run_readonly_command (call call_2f4d4258e2284b9b8e2676e9) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-25T10:59:47.062Z | intervention | tool read_user_decision (call call_15d0ee13c13f4faa98687272) | forbidden: a query round reads only the answer of an ask_person card its own line sent | 无理由 | - | 待定 |
| 2026-11-25T11:00:17.826Z | intervention | tool submit_plan_round (call call_2fd2c9c25b3a4e62b5cf2576) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase" | 无理由 | - | 待定 |
| 2026-11-25T11:00:31.895Z | intervention | tool submit_plan_round (call call_51211a23881e4bab9f9a2f30) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "checks" | 无理由 | - | 待定 |
| 2026-11-25T11:00:58.521Z | intervention | tool read (call call-8e3af25e-692d-4689-95e5-22671b1db9e8) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-25T11:01:06.326Z | intervention | tool edit (call call_01_9gWhhqCHKxL31lB2FUn97449) | execution_failed: test/lower.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-25T11:34:10.110Z | waiting | tool read (call call_9d630f9cc1824054a95b8f47) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-25T11:34:22.417Z | waiting | tool submit_initial_plan (call call_38d2cf698ee243d187fb7172) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T11:34:46.154Z | waiting | tool submit_secretary_answer (call call_07e096fadaf34f3a95fb1c38) | invalid_arguments: 工具参数不符合 schema：ideas: Invalid input: expected array, received undefined | 无理由 | - | 待定 |
| 2026-11-25T11:36:24.215Z | waiting | tool find_graph (call call_06800ecd829b498387e726bf) | invalid: a text search term must not contain whitespace | 产品规则 | - | 待定 |
| 2026-11-25T11:42:35.480Z | waiting | tool respond_session_message (call call_33d1e15d35314f2ebb95182c) | forbidden: 这条消息由这一轮的结论回复；要先说进度，另发一条不要回复的 | 无理由 | - | 待定 |
| 2026-11-25T12:14:28.459Z | waiting | tool edit (call call_2bbd9073e8284215a9259ca2) | execution_failed: test/triple.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-25T12:14:32.058Z | waiting | tool edit (call call_c01ef2f799b8472db5bb77ba) | execution_failed: test/triple.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-25T12:15:38.801Z | E08b | tool submit_initial_plan (call call_ed1cc1a2a18846bca2914304) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T12:17:29.369Z | E08b | tool send_session_message (call call_00_020624a23afh9zuqd0l7js2v) | not_found: the requested record does not exist | 无理由 | - | 待定 |
| 2026-11-25T12:17:38.835Z | E08b | tool look_graph (call call_d44ddb7bd6544f6e9086515e) | invalid_arguments: 工具参数不符合 schema：target.kind: Invalid discriminator value. Expected 'goal' \| 'stage' \| 'task' \| 'module' \| 'session' \| 'run' \| 'round'; (根): Unrecognized key: "kind" 或 memory: Invalid input: expected object, received undefined; (根): Unrecognized keys: "target", "kind" | 无理由 | - | 待定 |
| 2026-11-25T12:17:40.821Z | E08b | tool edit (call call_91a1e39ec3ad4fd2a4962f6c) | execution_failed: test/sub.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-25T12:17:57.918Z | E08b | tool submit_plan_round (call call_00_9foumaxsp3olf03esosf7n2k) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase"; plan.tasks.3: Unrecognized key: "phase"; plan: Unrecognized keys: "checks", "summary" | 无理由 | - | 待定 |
| 2026-11-25T12:18:10.592Z | E08b | tool submit_plan_round (call call_00_bf90sva68te8xfm2k9na7a2n) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T12:18:26.644Z | E08b | tool submit_plan_round (call call_00_95yco37tgadynwoujr582obm) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T12:18:40.268Z | E08b | tool submit_plan_round (call call_00_bfcrwi4fbufq0rhxdm9iq3ba) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T12:19:57.855Z | E08b | tool record_note (call call_00_ao7xf7rlfxuugpr8mmxi4hsn) | invalid_arguments: 工具参数不符合 schema：anchor: Invalid input: expected object, received undefined | 无理由 | - | 待定 |

每次拒绝一行：HTTP 拒绝（预期的也记，标 expected）和公开原历史里的每次工具拒绝（按调用身份去重），原文不截断。类别只认依据：busy/revision_conflict/idempotency_conflict/source_stale/capacity 记协调；理由点到不可逆、外部或秘密的记安全；理由点到规则的记产品规则；其余记“无理由”。

## A/B、压缩、附加格、B06

### A1

没跑：`uncovered (not-run)`。

### B1

没跑：`uncovered (not-run)`。

### 压缩

没跑：`uncovered (not-run)`。

### B06

没跑：`uncovered (not-run)`。

### E08b：uncovered

- sub-running（C-210）：pass。提交改需求时 sub（T1）的 Run 50369194-86de-4680-b2c3-539773b2810d 正在跑（开始于 2026-11-25T12:17:24.916Z）
- stop-delivered（C-210）：uncovered (not-run)。改需求没有写出候选（见 notes），没有发生采用，这一支没走到；任务卡 stop.steps：无；叫停请求 无；sub 的 Run completed @ 2026-11-25T12:17:56.512Z
- safe-point-end（C-210）：uncovered (not-run)。改需求没有写出候选（见 notes），没有发生采用，这一支没走到；任务卡 stop.steps：无；叫停请求 无；sub 的 Run completed @ 2026-11-25T12:17:56.512Z
- adopt-after-end（C-210）：uncovered (not-run)。改需求没有写出候选（见 notes），没有发生采用，这一支没走到；任务卡 stop.steps：无；叫停请求 无；sub 的 Run completed @ 2026-11-25T12:17:56.512Z
- the person selected idea 1 of 3 on the change: 按候选采用：sub 撤销，div 顶替，目标与验收同步改写
- 改需求没有候选：the request's last round 0ffa0460-37ad-459d-bc07-33f7a0a2d907 ended without a candidate and no Query ran for 5 min
- goal-confirm:goal.confirmDraft:19b1a50fe9ae897df1d0ad88ff844981d7013b6a634721e792d1ede460f2a7ff (NEEDS_DECISION): pause because E08b ended: committed

## 预算

- 上限：总量 360000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 16640453（输入 16364552，输出 275901；缓存命中 13441920）；Query 请求 231 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 21 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 实报输入（平台报了用量的部分，不含按预留上限计的和未计费 0）：16137090；估算部分 227462。
- 超预算退出：整轮 没有；按场景/格 没有。
- E05：用量 1033206（输入 1010858，输出 22348，缓存命中 849920；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1010858）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 0）
- E08：用量 1948217（输入 1922073，输出 26144，缓存命中 1498496；Query 请求 22（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 1922073）
- E09：用量 4313351（输入 4201360，输出 111991，缓存命中 3419136；Query 请求 79（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 4：Query 已关闭、用量未知），结束的 Run 2；实报输入 4016859）
- E12：用量 1013004（输入 1001667，输出 11337，缓存命中 793984；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1001667）
- iteration：用量 1370423（输入 1351471，输出 18952，缓存命中 1054464；Query 请求 26（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1351471）
- intervention：用量 795217（输入 783319，输出 11898，缓存命中 591744；Query 请求 14（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 783319）
- waiting：用量 1978495（输入 1950905，输出 27590，缓存命中 1617280；Query 请求 18（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 1：Query 已关闭、用量未知），结束的 Run 5；实报输入 1907944）
- E08b：用量 4188540（输入 4142899，输出 45641，缓存命中 3616896；Query 请求 38（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 5；实报输入 4142899）
- P6 记账：模型调用 347 次（公开原历史里 `model.request_started` 的条数，含 Work Run；压缩摘要的请求在另一个 Kernel Session 里，数不到，照旧记作缺口）；叫醒轮（intervention-planning）13 个，其中只回“收到”的 1 个（成功的工具调用只有读类和答复，且答复的都不是要回复的信，没交候选、没发信、没出卡；裁定 Q11、lead 11-25 #31，只计数不判；回复对象读不到的照旧计数，见其它记录）。
- E05：模型调用 28，叫醒轮 1，只回收到 0
- E08：模型调用 49，叫醒轮 1，只回收到 0
- E09：模型调用 58，叫醒轮 1，只回收到 0
- E12：模型调用 29，叫醒轮 1，只回收到 0
- iteration：模型调用 32，叫醒轮 1，只回收到 0
- intervention：模型调用 21，叫醒轮 1，只回收到 0
- waiting：模型调用 45，叫醒轮 4，只回收到 1
- E08b：模型调用 85，叫醒轮 3，只回收到 0

## 延迟探针

- w-accept#0：{"startedAt":"2026-11-25T08:34:47.296Z","writtenAt":"2026-11-25T10:18:08.677Z","samples":310675,"p50Ms":21.71,"p95Ms":22.18,"p99Ms":22.46,"maxMs":612.37,"meanMs":21.73}；关闭 SIGINT, exit 0 after 1195 ms
- w-accept#1：{"startedAt":"2026-11-25T10:18:08.758Z","writtenAt":"2026-11-25T11:37:46.541Z","samples":234897,"p50Ms":20.2,"p95Ms":21.58,"p99Ms":22.18,"maxMs":386.92,"meanMs":20.5}；关闭 SIGINT, exit 0 after 277 ms
- w-accept#2：{"startedAt":"2026-11-25T11:39:56.751Z","writtenAt":"2026-11-25T12:27:04.273Z","samples":138104,"p50Ms":20.17,"p95Ms":20.5,"p99Ms":21.54,"maxMs":471.6,"meanMs":20.47}；关闭 SIGINT, exit 0 after 98 ms

## 其它记录

- 2026-11-25T10:18:28.770Z E12: E09: request f96a9690-20f3-48aa-940a-ccdb6aa57743 counted at its reservation 45601+16384 (usage unknown; Query closed cancelled; counted at the reservation (upper bound))
- 2026-11-25T10:18:28.770Z E12: E09: request 2ecc74f9-ec85-4680-8047-75e531aa7e04 counted at its reservation 45533+16384 (usage unknown; Query closed cancelled; counted at the reservation (upper bound))
- 2026-11-25T10:18:28.770Z E12: E09: request b47d6faa-f7b3-44ae-abbf-e4d88067bb90 counted at its reservation 49312+16384 (usage unknown; Query closed cancelled; counted at the reservation (upper bound))
- 2026-11-25T10:18:28.770Z E12: E09: request 9cd0595c-905f-43ed-bb17-bb0b2ea50e3b counted at its reservation 44055+16384 (usage unknown; Query closed cancelled; counted at the reservation (upper bound))
- 2026-11-25T11:40:00.372Z waiting: waiting: request e6af2d8b-75d3-4119-babb-52a1f9af0035 counted at its reservation 42961+16384 (usage unknown; Query closed cancelled; counted at the reservation (upper bound))
- 2026-11-25T12:27:04.290Z -: §6.2：Query 在“进入中”被中止由 qent 关成 not_entered（aborted_before_entry）；`queries/cancel` 在 entering 窗口仍回 not_running，本次不测、不判场景失败。
