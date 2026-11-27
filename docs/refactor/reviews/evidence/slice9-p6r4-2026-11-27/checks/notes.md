# G6 notes 2026-11-26（运行号 g6-2026-11-26-22be1e84）

## 逐场景判据

### E05：fail

- C 行：C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 9667383（含缓存命中），输出 66825，缓存命中 8408064，Query 请求 128。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| overlap | C-182, C-183, C-217 | fail | t-users 2 个 Run、t-orders 3 个 Run，没有一对在不同 Session 上时间重叠 |
| gate | C-185 | pass | 门：module src-orders，等待 t-orders，在跑 t-users/0e57e7aa-2281-4c84-9686-4b7c758ce8e7；放行 人放行 1 道（rejected） |
| paths | C-185, C-217 | pass | files/compare 给出：.workbench/notes/63d5374601ea7365081e0f97b06d48f3/46fd3354-a9d9-4ca1-a279-4e493be2703e.md, .workbench/notes/63d5374601ea7365081e0f97b06d48f3/83210372-60b0-4206-8183-8f10dbbcd71c.md, .workbench/notes/63d5374601ea7365081e0f97b06d48f3/99cda0c3-bd35-458f-b7e2-c6532ba46d40.md, .workbench/notes/63d5374601ea7365081e0f97b06d48f3/d59ea901-cd3b-470c-badd-5f3eb9f2be46.md, .workbench/notes/63d5374601ea7365081e0f97b06d48f3/dc9407a2-bafb-463e-9a29-a93693fe138c.md, src/legacy/contact-check.js, src/legacy/is-email.js, src/orders.js, src/rules.js, src/users.js, test/orders.test.js, test/users.test.js |
| kept | C-185 | fail | t-users failed，t-orders failed；目标停下等人：the platform stopped: no_new_basis on t-users |
| single-occupancy | C-71 | pass | 5 个 Run，没有同 Session 时间重叠 |
| convention | C-208 | pass | rules.js 定义 isEmail：true；users/orders 都从 rules 引用 |
| duplicates | C-208 | fail | 成功的 project_source（duplicates:true）结果 0 个，候选 0 条，没有一条的两处位置之一是 src/legacy/contact-check.js |
| reviewer | C-208, C-218 | pass | 轮 {"aggregateType":"VerificationRound","projectId":"c0213cfd2501a34be2d96d4595c2a855","workspaceId":"63d5374601ea7365081e0f97b06d48f3","goalId":"g6-e05-mwxwpdpq-27","taskId":"t-users","runId":"1eb07cc3-67c0-4f0e-a293-30e732cab228","roundId":"455cec17-2d75-4eb3-8ee8-501df133b77a"} 的正式审阅 Evidence 88a835bd-3956-4b05-b6d0-d4dfaec664e4：PASS；审阅要求状态 pass |
| name-different | C-208 | uncovered (entry-missing) | 正式审阅答复提到 contact-check.js / looksLikeMailAddress，但文字没有明确结论：「- 全库检索 `isEmail`/`EMAIL_PATTERN`/`looksLikeMailAddress`/`254`：规则定义只出现在 `src/rules.js`」 「- `src/legacy/is-email.js`（同名 `isEmail`，只判 `length<=254`）与 `src/legacy/contact-check.js`（`looksLikeMailAddress`，宽松正则，无类型检查）：」 |
| name-same | C-208 | uncovered (entry-missing) | 正式审阅答复提到 is-email.js，但文字没有明确结论：「- `src/legacy/is-email.js`（同名 `isEmail`，只判 `length<=254`）与 `src/legacy/contact-check.js`（`looksLikeMailAddress`，宽松正则，无类型检查）：」 |
| temporary | C-208 | uncovered (not-run) | 目标停下等人（the platform stopped: no_new_basis on t-users），没走到这一步 |
| line-choice | C-73, C-191 | uncovered (not-run) | 运行中读到的派工依据 0 个，没有一个选中了线（rank 都是 none 或没读到）；候选线清单本来不另存（MVP-BEHAVIOR.md:350） |

- driver-start t-users: ready running
- driver-start t-orders: ready running
- driver-start goal: ready running
- planted src/legacy/contact-check.js: ready
- planted src/legacy/is-email.js: ready
- 人放行重叠门 src-orders（等待 t-orders）：rejected invalid the overlap gate is already satisfied
- g6-e05-mwxwpdpq-27: 人已答、等 agent 记落实（record_decision_application）的 message 卡 1 张（不算人手上的卡，P6 Q2；skill 缺口的证据）
- E05 Goal ended NEEDS_DECISION
- E05 目标停下等人：the platform stopped: no_new_basis on t-users
- g6-e05-mwxwpdpq-27 (NEEDS_DECISION): pause because E05 ended: committed

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
- 用量：输入 816849（含缓存命中），输出 10972，缓存命中 650240，Query 请求 15。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| autonomy-born | C-133a | pass | 草稿自治 every_step；Goal 生在版本 1，采用后读到 every_step |
| confirm-only-latest | C-47 | pass | 同一草稿换 commandId 再确认：rejected revision_conflict |
| person-adopts | C-46, C-52 | pass | 人确认之前 goals/list 里没有这个 Goal（0 个旧 Goal）；首方案由人 initialization/adopt |
| first-adoption | C-63, C-62 | pass | 采用回执 plan initial-plan-718d9b3bee893561a116e9d818afa3ea；Goal 指针 {"aggregateType":"PlanRevision","projectId":"de89e8f2c856f37001e6d0b57f0a7102","planId":"initial-plan-718d9b3bee893561a116e9d818afa3ea"} |
| hold-before-adopt | C-210 | uncovered (not-run) | stopped before this check: no change candidate: the model wrote none |
| versions | C-210 | fail | 模型没有写出改需求的候选（轮 ad2f07d7-7843-482a-9bbb-b71bc11bb940 跑了，没交 submit_plan_round，见 notes 的“改需求没有候选”），没有可由人采用的改后版本 |
| switch | C-210 | uncovered (not-run) | stopped before this check: no change candidate: the model wrote none |
| old-evidence | C-210 | uncovered (not-run) | stopped before this check: no change candidate: the model wrote none |
| required-cancel | C-210 | uncovered (not-run) | stopped before this check: no change candidate: the model wrote none |
| autonomy-later | C-126 | uncovered (not-run) | 草稿本来就是 every_step，这次没有中途改档 |
| control-pins | C-116, C-118 | pass | 只钉 Goal 的暂停：rejected invalid |

- first plan initial-plan-718d9b3bee893561a116e9d818afa3ea: sub = t1，mul = t2
- 提交前最近一次轮询：mul 1 个 Run（starting），sub 0 个 Run；sub 的 dispatch.claimableNow null
- while the change candidate was written the person answered message card {"kind":"message","messageRef":{"aggregateType":"SessionMessage","messageId":"session-message-62627c3e4ea0d61157842be5546d36454f20cc1fbb7360b4a2da3ae981ca9036","projectId":"de89e8f2c856f37001e6d0b57f0a7102","workspaceId":"d2e8b47a0653731209e6595dff060113"}}
- 改需求没有候选：the request's last round ad2f07d7-7843-482a-9bbb-b71bc11bb940 ended without a candidate and no Query ran for 5 min
- E08 没有候选时 sub 的任务卡：暂缓 agent/held by agent:secretary@2026-11-26T19:02:38.846Z；sub 的 Run 0 个（hold-before-adopt 没走到采用前那一步，不改判）
- stopped: not-run: no change candidate: the model wrote none
- goal-confirm:goal.confirmDraft:a2cc8236336e043746fe7efcb532db13f9b773006b9270323374a6a0c2651fd3 (CHANGE_PENDING): pause because E08 ended: committed

### E09：uncovered

- C 行：C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 6799660（含缓存命中），输出 65516，缓存命中 6216576，Query 请求 104。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| executor-reports | C-185, C-211 | pass | 执行者上报 session-message-4c87f479661b8246bac49b72354ec9d56d6e2c13b6d697ac16b667c3faac1ce2（要回复的 send_session_message）：发件线 session-37662e7cb8a2bba6776917bce9c9b39422263b5a2b0139742d85b5f5b64ea5e7（work_run）→ 收件线 session-137711075294c7760962d363c2040705fb965b0e99b2ce84a5577918d50bb848（参谋），needsReply true，answeredBy line；还没有答复；参数 {"needsReply":true,"recipient":{"projectId":"e987163f5c3e2d5cb6691855dea7f2a1","sessionId":"session-137711075294c7760962d363c2040705fb965b0e99b2ce84a5577918d50bb848"},"taskRef":{"goalId":"goal-confirm:goal.confirmDraft:d344b50bd91140688d0cfef49049bcc3a9b9c9c0d37a259be70259559d0bde2d","projectId":"e987163f5c3e2d5cb6691855dea7f2a1","taskId":"tA"},"text":"【tA 执行者上报：parseDate 返回值契约冲突，需请用户裁决（tGate）】\n\n一、已完成（tA，只改了自己的文件）\n- src/api.js 实现并导出 parseDate(text)，返回 Date；目前是全仓唯一解析日期的地方。\n- 新增 test/api.test.js（8 条用例）。在工作区根目录 node --test：exit 0，14 通过 0 失败（14 = 我的 8 条 + tB 线的 report.test.js 6 条）。\n- 未改动 src/report.js（tB 的另一条线已经写完 monthOf，它也是消费 Date，没改我的契约）。\n\n二、冲突对象（事实）\nsrc/api.js 的 parseDate 返回值：当前实现返回 Date（UTC 字段），而 report 侧 monthOf 需要“年月”。\n- 之前只有一句“待裁决”，没有任何实现可谈；现在已落地为 Date，冲突才变得具体、可裁决。\n- 注意：我落地的是 tA 任务书指定的 Date，属于“裁决前的当前实现”，不是用户裁定结果。我没有为 report 的需要改返回类型，也没有改 report。\n\n三、两侧调用点与实际影响\n- api 侧 src/api.js:parseDate —— 返回 Date；非法输入（非字符串、非 YYYY-MM-DD、2024-04-31/2023-02-29 这类非真实日历日）一律抛 TypeError，不返回 Invalid Date/undefined。\n- report 侧 src/report.js:monthOf —— import { parseDate } from './api.js'，用 getUTCFullYear/getUTCMonth 从 Date 派生 \"YYYY-MM\"；内部还有一道 instanceof Date/NaN 检查，一旦 parseDate 不再返回有效 Date 会在 monthOf 显式报错，不会静默错算。\n  结论：即使最终裁定 {y,m,d}，现有代码会以“抛错”暴露，而不是悄悄算错。但这仍是一次破坏性契约变更，会影响所有 parseDate 调用点——目前只有 report 一个，但接口本身就是对外承诺。\n\n四、给用户的裁决选项（参谋转述时可直接用）\n1) 保持 Date（推荐）：零改动、现有测试全绿；消费方按需用 getUTC* 或自行转 {y,m,d}。\n2) 改为 {y,m,d}：api.js 与 test/api.test.js 要改，report.js 也要改（虽不归我改）；所有调用点受影响，且 {y,m,d} 丢失时区意图、两次解析易分叉。\n3) 新增并行导出（如 parseDateParts）保留 Date 契约：改动面可控，但要定归属与命名，属于新接口需参谋定。\n\n五、需要参谋做的\n把“parseDate 返回 Date 还是 {y,m,d}”、两侧调用点、影响面整理给用户，取得裁决记录后收掉 tGate。我在 tGate 出结果前不改动任何接口。注记已写：接口 api/parseDate 下 topic「parseDate 实际实现」（noteId 256b42de-8d26-458f-a111-0eba249299e5）。"} |
| adviser-explains | C-211 | uncovered (not-run) | 上报 session-message-4c87f479661b8246bac49b72354ec9d56d6e2c13b6d697ac16b667c3faac1ce2 发给了参谋线 session-137711075294c7760962d363c2040705fb965b0e99b2ce84a5577918d50bb848，但参谋的 3 个轮的输入里都没有它：参谋还没处理这条上报 |
| person-decides | C-211, C-62 | uncovered (not-run) | 参谋没有解释这条上报（uncovered），人对它的决定和新版本这两环没有发生 |
| new-version | C-211, C-55 | uncovered (not-run) | 参谋没有解释这条上报（uncovered），人对它的决定和新版本这两环没有发生 |
| report-after-dispatch | C-185, C-211 | uncovered (not-run) | 同目标没有 agent 派活落实（任务卡 dispatch.request 没有 applied 的），这一支没走到 |
| diagnosis-reverify | C-211 | uncovered (not-run) | 2 个检查轮里没有一轮的重验以消息为依据（reverify.newInputRefs 没有 session_message），这一支没走到（可选） |
| formal-change | C-212 | pass | architecture/revise committed  ；目录版本 2 |
| drift | C-212, C-89 | pass | compare-formal 3 条 finding；带路径的：package.json, README.md, src/report.js |
| observation-after-adopt | C-65 | pass | 采用后观测 {"aggregateType":"ObservedArchitecture","projectId":"e987163f5c3e2d5cb6691855dea7f2a1","workspaceId":"162ee43e7197c0d9137437b149235cca","captureId":"a443c0bb-fdc8-4e60-a1a8-1c0a670c0b6b"} |
| observation-after-pass | C-98 | pass | 观测：采用后 {"aggregateType":"ObservedArchitecture","projectId":"e987163f5c3e2d5cb6691855dea7f2a1","workspaceId":"162ee43e7197c0d9137437b149235cca","captureId":"a443c0bb-fdc8-4e60-a1a8-1c0a670c0b6b"} → 现在 {"aggregateType":"ObservedArchitecture","projectId":"e987163f5c3e2d5cb6691855dea7f2a1","workspaceId":"162ee43e7197c0d9137437b149235cca","captureId":"626f5ca2-804f-46b3-bea4-fbc285b2c792"} |
| rounds | C-93, C-95, C-218 | pass | satisfied 任务的最新轮：tA PASS/gaps 0, tB PASS/gaps 0 |
| uncovered-round | C-99 | uncovered (not-run) | 这次没有出现缺覆盖（INCONCLUSIVE）的检查轮 |

- goal-confirm:goal.confirmDraft:d344b50bd91140688d0cfef49049bcc3a9b9c9c0d37a259be70259559d0bde2d: 人已答、等 agent 记落实（record_decision_application）的 message 卡 1 张（不算人手上的卡，P6 Q2；skill 缺口的证据）
- E09 Goal ended COMPLETED
- 8E contact 层：uncovered (8E optional)（只记在这里，不进 uncovered[]；9-start-rulings.frozen.md:966-967）

### E12：fail

- C 行：C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1551385（含缓存命中），输出 16475，缓存命中 1267072，Query 请求 20。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| reads-quiet | C-36 | pass | QueryRun 3→3，输入 478970→478970，changesHead h0000001850→h0000001850 |
| graph-cards | C-88, C-89 | pass | goal children 1，find 5，path 卡 有 |
| raw-history | C-42, C-157 | pass | 线的原历史 76 条，Run 历史 75 条 |
| completion-chain | C-104 | pass | 检查轮卡 2 张，有非空 evidenceRefs：true |
| restart-state | C-145, C-215 | pass | 重启后旧 Goal COMPLETED，计划 initial-plan-08246fdeae50ecc66daede2f3d4b41ac，Run 1/1 |
| reconcile | C-146 | pass | host/reconcile-report：lease owned |
| redrive-sets | C-155 | pass | 旧 Goal 的 causes：[{"code":"change_pending","proposalRef":{"aggregateType":"PlanProposal","projectId":"04aec03adab5cdbd1f0bc19f8cd6b6b0","workspaceId":"b4a585b7eadda0bdf49c9acff1f3f875","proposalId":"plan-proposal-9836 |
| new-goal | C-114, C-158 | fail | the platform did not do it: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g-farewell-stage has no ended ordinary producer Run yet) |
| history-reuse | C-220 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g-farewell-stage has no ended ordinary producer Run yet) |
| stale-premise | C-220 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g-farewell-stage has no ended ordinary producer Run yet) |
| replay | C-147 | pass | 同一 flowId 两次 driver-start：ready/ready，state running/running |
| wait-registry | C-207 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g-farewell-stage has no ended ordinary producer Run yet) |

- restart: SIGINT, exit 0 after 356 ms
- goal-confirm:goal.confirmDraft:d31fabbcb6eee780392a04fc61dc9ce7bef48580729725047a8b812e8af31477: the person selected idea 1 of 3 (A. 极简追加：farewell(name) 返回 "goodbye <name>"，用例加进现有测试文件)
- stopped: not-run: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g-farewell-stage has no ended ordinary producer Run yet)
- goal-confirm:goal.confirmDraft:d31fabbcb6eee780392a04fc61dc9ce7bef48580729725047a8b812e8af31477 (RUNNING): pause because E12 ended: committed

### iteration：pass

- C 行：C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1517624（含缓存命中），输出 23498，缓存命中 1263744，Query 请求 27。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ideas | C-108 | pass | 3 个思路，目标卡草稿 0 |
| select | C-109 | pass | select-idea queued；下一轮输入提到所选：true |
| candidate | C-110 | pass | 候选 plan-proposal-1e5d10a62058181fe45dd03bdb3f23fb（candidate） |
| what-changed | C-213, C-110 | pass | 第二轮回答说明改动：true；新候选 plan-proposal-f37c65551e2e3f033e11d754a3dd763f，前一版 {"proposalRef":{"aggregateType":"PlanProposal","projectId":"9dd0b2a109540edbea513810188558c1","workspaceId":"a457b6ce6830f8da2438ff069a98ea7c","proposalId":"plan-proposal-1e5d10a62058181fe45dd03bdb3f23fb"},"revision":2} |
| per-request | C-111 | pass | 采用第一请求的候选 committed；第二请求候选 plan-proposal-8031c8a9a905715c0fd0aebed3a98ad0 现在 stale |
| why | C-112, C-226 | pass | 追问后候选不变：true；回答 1749 字 |
| continues | C-105 | pass | 同一请求 3 轮，秘书 Session session-44693f796b6c80d5d65b2da8adeb41f5d81334afeb1eb9a9fd1dfc4eea9fa525 |
| request-goal | C-107 | pass | 请求记的目标 goal-confirm:goal.confirmDraft:57905865d665c59a92fe51cb9f17eb18a4366f4e293902fcd6407e42ffc497c4 |
| cards-ask | C-113 | pass | 秘书线的 turn 输入带 ## Cards：true |
| multi-round | C-194 | pass | 后续轮的回答接上前面改过的内容（process.argv） |

- goal-confirm:goal.confirmDraft:57905865d665c59a92fe51cb9f17eb18a4366f4e293902fcd6407e42ffc497c4 (RUNNING): pause because iteration ended: committed

### intervention：fail

- C 行：C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 2746702（含缓存命中），输出 34514，缓存命中 2437248，Query 请求 44。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ask-copy | C-198 | pass | 问一问 queued → answered；原线 Run ended/completed，输入含这个问题的轮 无；问件 session-message-3c0b00cacf6bf84b33f8cbda2f75704021e75549938de24a73c495f0c54810d4 answeredBy copy，送进 无 |
| delivery-states | C-189, C-192 | pass | disposition 依次：offerable → delivered（发送回执 sent）；发信时在跑的 Run 5ae481dc-b46f-4ed6-ba59-6cfaf481bcb2；送进 Run 5ae481dc-b46f-4ed6-ba59-6cfaf481bcb2 |
| busy-original-words | C-189, C-199 | pass | 送进发信时在跑的 Run 5ae481dc-b46f-4ed6-ba59-6cfaf481bcb2（接受于 2026-11-26T19:58:52.299Z）；这个 Run 输入含原话的轮：kturn-3d181871a37ebb99365fcfdd82d87fdf620caa1f1d46e95a40e1465f6a35569e |
| continue-no-planning | C-199 | pass | 发送时线上当前任务 goal-confirm:goal.confirmDraft:815694681c349d9cad0947f7ed3aa8243ae0895c63badde27bb4ccf6aee44a5e/t2 active/running；这条消息的 intervention_planning Query：没有 |
| planning-when-idle | C-199, C-200 | fail | the platform did not do it: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:815694681c349d9cad0947f7ed3aa8243ae0895c63badde27bb4ccf6aee44a5e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| claim-once | C-199 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:815694681c349d9cad0947f7ed3aa8243ae0895c63badde27bb4ccf6aee44a5e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| four-endings | C-201, C-202, C-203 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:815694681c349d9cad0947f7ed3aa8243ae0895c63badde27bb4ccf6aee44a5e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| review-packet | C-199 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:815694681c349d9cad0947f7ed3aa8243ae0895c63badde27bb4ccf6aee44a5e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| completed-goal | C-114 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:815694681c349d9cad0947f7ed3aa8243ae0895c63badde27bb4ccf6aee44a5e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| paused-queues | C-197 | fail | the platform did not do it: timed out after 30 min waiting for delivery after resume |

- goal-confirm:goal.confirmDraft:815694681c349d9cad0947f7ed3aa8243ae0895c63badde27bb4ccf6aee44a5e: the person selected idea 1 of 3 (A 串行：一函数一任务，最后闸跑全量测试)
- driver-start goal-confirm:goal.confirmDraft:815694681c349d9cad0947f7ed3aa8243ae0895c63badde27bb4ccf6aee44a5e: ready running
- paused-queues: later read fail: 暂停 committed（目标当时 RUNNING）：暂停中 offerable；恢复 committed  后 30 分钟里没有收尾
- stopped: not-run: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:815694681c349d9cad0947f7ed3aa8243ae0895c63badde27bb4ccf6aee44a5e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:815694681c349d9cad0947f7ed3aa8243ae0895c63badde27bb4ccf6aee44a5e (RUNNING): pause because intervention ended: committed
- intervention ended: after 30 min still Query 0, Work Run 1, Goals not paused none; cancelling what is left
- intervention ended: cancel ad16ed16-b0dc-43eb-b821-b1b42388b38d: submit committed, deliver ready  

### waiting：uncovered

- C 行：C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 2437485（含缓存命中），输出 37196，缓存命中 2116864，Query 请求 29。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| wait-open | C-188, C-225 | pass | 成员 session-b5d265685bf67307ce2913b3f0668a4de2797670863275cc060afeccdad5be2c 的 Work（Run ecd61742-9bd0-44a4-9bae-1d1ce098792a）经工具发出等待 session-message-95492b23b0569ba2a29e59a83d06cc8c48659cc7003ba5588e9dff0d01827ad3：收信人 session-552ab754cf5be17f555d6a595053342fd1c3b4ec7aa4888508d40b0b10514fe0，期限 2026-11-26T23:33:37.052Z，waitAfterSend true；发信的 Run ecd61742-9bd0-44a4-9bae-1d1ce098792a ended/yielded，continuation wait_reply → session-message-95492b23b0569ba2a29e59a83d06cc8c48659cc7003ba5588e9dff0d01827ad3 |
| interject-keeps-wait | C-188, C-224 | pass | 插话 session-message-4f1d7bc4d4c8753cbfd17087c2dc2f7f9616c50305428278246c08a985d6083d（sent）：接它的 Run fc4bd584-4f0f-4250-863b-b4be9a425f2b（consumedWait intervention，在 session-b5d265685bf67307ce2913b3f0668a4de2797670863275cc060afeccdad5be2c）；原等待 session-message-95492b23b0569ba2a29e59a83d06cc8c48659cc7003ba5588e9dff0d01827ad3 open，期限 2026-11-26T23:33:37.052Z（原 2026-11-26T23:33:37.052Z）；新中断通知 成员侧 1 条、秘书侧 1 条 |
| restart-kept | C-170, C-207 | pass | 重启后同一等待：从sessions/facts 的 waits（expired）读到，期限 2026-11-26T23:33:37.052Z（原 2026-11-26T23:33:37.052Z），收信人 session-552ab754cf5be17f555d6a595053342fd1c3b4ec7aa4888508d40b0b10514fe0；消费它的接受 expiry → Run 6d5b14e3-40b2-4194-9c13-13b6621d8570；接续的 Run 6d5b14e3-40b2-4194-9c13-13b6621d8570 consumedWait expiry，messageRef session-message-95492b23b0569ba2a29e59a83d06cc8c48659cc7003ba5588e9dff0d01827ad3，originalRun ecd61742-9bd0-44a4-9bae-1d1ce098792a（原 ecd61742-9bd0-44a4-9bae-1d1ce098792a），在 session-b5d265685bf67307ce2913b3f0668a4de2797670863275cc060afeccdad5be2c（成员 session-b5d265685bf67307ce2913b3f0668a4de2797670863275cc060afeccdad5be2c） |
| expiry-once | C-171, C-190 | pass | expiredAt 2026-11-26T23:34:41.035Z；记下时消费 false；之后由 expiry 消费 |
| second-expiry | C-171, C-190, C-224 | uncovered (not-run) | 第二封等待已由回复消费（2026-11-26T23:36:54.772Z），回复胜过到期（STATE-MACHINES-SPEC.md:3650） |
| consumes | C-187 | pass | 等待 session-message-95492b23b0569ba2a29e59a83d06cc8c48659cc7003ba5588e9dff0d01827ad3 的接受条目：message:false@2026-11-26T23:36:44.015Z, expiry:true@2026-11-26T23:36:54.732Z（只认一次真实接受消费等待） |
| late-reply | C-224, C-189 | uncovered (not-run) | 等了 60 分钟还没来；到期（2026-11-26T23:34:41.035Z）被消费之后没有回复（回复槽空，也没有接受的回复） |
| reply-first | C-187, C-224 | pass | 第二个问题 session-message-5087f5d0e5a706c52c4b2793b943b1c46e25baad718703efd3563e25450d8556（期限 2026-11-27T00:06:54.664Z）：回复 2026-11-26T23:37:45.561Z；消费它的接受 response@2026-11-26T23:38:03.030Z；expiredAt 无 |
| transfer | C-224 | uncovered (env-unavailable) | 第二个问题 session-message-5087f5d0e5a706c52c4b2793b943b1c46e25baad718703efd3563e25450d8556（期限 2026-11-27T00:06:54.664Z）：转交前已被回答（默认叫醒，P6 #17） |
| disconnect | C-195, C-196 | uncovered (env-unavailable) | 归档前成员线上已没有开着的等待（都已回答或处理），断开无从造出 |
| supply-order | C-172, C-192, C-184 | uncovered (not-run) | 公开读口给出 9 项接受顺序（见 notes），但“接受顺序等于供给顺序”没有书面依据，不判 pass |

- P6 Q8 插话在第一个等待开着时发出；它让成员线多开了一个 Run（fc4bd584-4f0f-4250-863b-b4be9a425f2b），之后的到期链在这之后发生
- 关 Host 时 t-wait 的 Run 在 starting（fc4bd584-4f0f-4250-863b-b4be9a425f2b）：已领取、未进入，重启后同一次领取续驱（W-01..W-03），不是等待的接续
- close and restart: SIGINT, exit 0 after 291 ms
- restart: resumeOnStartup = ask
- 供给顺序旁证（run.input_accepted 的接受顺序，不作判据）：krun-c330d3262e846aeffa3cd1441ebcb2910f66849d03bfbc058599ab3ae8342224/kturn-5374b2fbf1e8b3a8fa60cedcf163f00e8b9fa654281f84026fd8ccef10ecc6b8: SessionMessage/message session-message-4f1d7bc4d4c8753cbfd17087c2dc2f7f9616c50305428278246c08a985d6083d 用户插话（消息 session-message-4f1d7bc4d4c8753cbfd17087c2dc2f7f9616c50305428278246c08a985d6083d）： 插一句：先别改代码，继续等秘书回答你刚才的问题，拿到回答再 ｜ krun-c330d3262e846aeffa3cd1441ebcb2910f66849d03bfbc058599ab3ae8342224/kturn-5374b2fbf1e8b3a8fa60cedcf163f00e8b9fa654281f84026fd8ccef10ecc6b8: SessionMessage/message session-message-ac9ac0b2d38636b051186516839c1715629d74a8e73b0cced3734f6b6752ee92 消息 session-message-ac9ac0b2d38636b051186516839c1715629d74a8e73b0cced3734f6b6752ee92，来自 平台，要回复：否，叫醒你：不会 中断通知 · Session se ｜ krun-273284b456b54471899b7211a4669585b46e72db506236c5d50d100144fde24e/kturn-4e433b0952590b9d0885654c0214ad6b325c47f4f2092d0154d42010829e63dd: SessionMessage/expiry session-message-95492b23b0569ba2a29e59a83d06cc8c48659cc7003ba5588e9dff0d01827ad3 你的问题到截止时间还没有回复（消息 session-message-95492b23b0569ba2a29e59a83d06cc8c48659cc7003ba5588e9dff0d01827ad3，截止 2026-11-26T23:33:3 ｜ krun-273284b456b54471899b7211a4669585b46e72db506236c5d50d100144fde24e/kturn-4e433b0952590b9d0885654c0214ad6b325c47f4f2092d0154d42010829e63dd: SessionMessage/message session-message-a06c3010c1a81e2b2547411af2c0790f6d64d2ab7dbbc0ce207a96fb04f48ec1 消息 session-message-a06c3010c1a81e2b2547411af2c0790f6d64d2ab7dbbc0ce207a96fb04f48ec1，来自 session-552ab754cf5be17f555d6a595 ｜ krun-273284b456b54471899b7211a4669585b46e72db506236c5d50d100144fde24e/kturn-4e433b0952590b9d0885654c0214ad6b325c47f4f2092d0154d42010829e63dd: SessionMessage/response session-message-631b3b3bb6782af8f7912c8d2cecb14331b2faa93035c4c3a278de6177a0b675 你的问题有了回复（消息 session-message-631b3b3bb6782af8f7912c8d2cecb14331b2faa93035c4c3a278de6177a0b675）。 你的问题： num.js 现在有哪些导出函数？（第 ｜ krun-f05577d330a9cbfdef3044ca148fb4427e76c2e7d019ec48f9a61f5fbeaa8699/kturn-104dd4436a08d455499e58fea299bc2826e09e363ed3df4879e722f1b0e2bc09: SessionMessage/response session-message-5087f5d0e5a706c52c4b2793b943b1c46e25baad718703efd3563e25450d8556 你的问题有了回复（消息 session-message-5087f5d0e5a706c52c4b2793b943b1c46e25baad718703efd3563e25450d8556）。 你的问题： README 的标题要不要改成中文？（ ｜ krun-f05577d330a9cbfdef3044ca148fb4427e76c2e7d019ec48f9a61f5fbeaa8699/kturn-104dd4436a08d455499e58fea299bc2826e09e363ed3df4879e722f1b0e2bc09: SessionMessage/message session-message-1c4ff50b90c32a7250b7886155aeef9030a078f3012609981bd07ea147721e52 消息 session-message-1c4ff50b90c32a7250b7886155aeef9030a078f3012609981bd07ea147721e52，来自 session-552ab754cf5be17f555d6a595 ｜ krun-245609d112eda0ddb1d9481b285be99a0ccadad782e9bbd6f5ef03f2649b61df/kturn-f87a8b5e81fb35547815ef6a5d7fae744954cb28a7f772a29b9b7ce60e02638f: SessionMessage/response session-message-b87b1a5539690bd664a635cfb866e623a31dd21f1e042bb0a303ff3612639cfc 你的问题有了回复（消息 session-message-b87b1a5539690bd664a635cfb866e623a31dd21f1e042bb0a303ff3612639cfc）。 你的问题： 请判定：检查项 readme-scop ｜ krun-245609d112eda0ddb1d9481b285be99a0ccadad782e9bbd6f5ef03f2649b61df/kturn-f87a8b5e81fb35547815ef6a5d7fae744954cb28a7f772a29b9b7ce60e02638f: SessionMessage/message session-message-2741f71ea2683a96251c62b84e044b50fc6ada7ee50f6dbf693b196e9b21f800 消息 session-message-2741f71ea2683a96251c62b84e044b50fc6ada7ee50f6dbf693b196e9b21f800，来自 session-552ab754cf5be17f555d6a595
- 等待链 session-message-95492b23b0569ba2a29e59a83d06cc8c48659cc7003ba5588e9dff0d01827ad3 → session-message-631b3b3bb6782af8f7912c8d2cecb14331b2faa93035c4c3a278de6177a0b675；结束方式 cap
- g6-wait-mwy6s9nw-92 (NEEDS_DECISION): pause because waiting ended: committed

## 撞墙表

| 时间 | 场景 | 哪一步 | 看到的拒绝原文和理由 | 类别 | 预期 | 建议包 |
|---|---|---|---|---|---|---|
| 2026-11-26T18:45:20.155Z | A1 | core/completion-policies/read | not_found: project cf3996f8b4b821c27e0efdae69b223d0 has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-26T18:46:35.661Z | B1 | core/completion-policies/read | not_found: project g6-wb has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-26T18:48:06.413Z | E05 | tool submit_initial_plan (call call_f369a1f137784e6fb10b88d8) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized keys: "setup", "goalCardDrafts", "planDraftIndex"; setup: Invalid input: expected object, received undefined; goalCardDrafts: Invalid input: expected array, received undefined; planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-26T18:48:15.633Z | E05 | tool submit_initial_plan (call call_807a33d816b24d658b0c11e0) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-26T18:48:58.984Z | E05 | tool dispatch_task (call call_a995e46651b94a348a2d7d1b) | busy: the Task is in progress; its lease is still held by a running Run | 协调 | - | 待定 |
| 2026-11-26T18:49:01.867Z | E05 | tool look_graph (call call_e87fe0c9cbe745af8a1453a5) | invalid_arguments: 工具参数不符合 schema：target.ref: Unrecognized key: "aggregateType" | 无理由 | - | 待定 |
| 2026-11-26T18:49:25.870Z | E05 | tool submit_plan_round (call call_153265a6d17f421a89300f3f) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase" | 无理由 | - | 待定 |
| 2026-11-26T18:49:33.839Z | E05 | tool edit (call call_1e42707428c740adb89c8281) | execution_failed: test/users.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-26T18:50:11.445Z | E05 | tool record_note (call call_35d029a75f024107af20c083) | invalid_arguments: 工具参数不符合 schema：op: Invalid discriminator value. Expected 'write' \| 'review' \| 'withdraw' | 无理由 | - | 待定 |
| 2026-11-26T18:50:51.638Z | E05 | tool record_note (call call_2fc57822127649519fdcb120) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized keys: "expectedVersion", "noteId" | 无理由 | - | 待定 |
| 2026-11-26T18:53:46.874Z | E05 | tool record_note (call call_6ac4d4dea3544225bf932351) | invalid_arguments: 工具参数不符合 schema：topic: Invalid input: expected string, received undefined; conclusion: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-26T18:54:41.469Z | E05 | tool list_files (call call_be6c720b90d145e28afc5d59) | invalid_arguments: 工具参数不符合 schema：prefix: Too small: expected string to have >=1 characters; prefix: Use a workspace-relative path | 无理由 | - | 待定 |
| 2026-11-26T18:54:52.318Z | E05 | tool run_readonly_command (call call_7c2279ad9a3049fea93bc309) | execution_failed: workspace_changed_during_readonly_command: the workspace was changed by another writer during the command; the changed paths are in the output | 无理由 | - | 待定 |
| 2026-11-26T18:54:52.910Z | E05 | tool run_readonly_command (call call_4b6b5186ed1042df972400b0) | execution_failed: workspace_changed_during_readonly_command: the workspace was changed by another writer during the command; the changed paths are in the output | 无理由 | - | 待定 |
| 2026-11-26T18:55:01.812Z | E05 | tool ask_person (call call_d2a3fa39b9864597b112bae8) | invalid: the decision request options or objects are invalid | 无理由 | - | 待定 |
| 2026-11-26T18:55:08.342Z | E05 | tool ask_person (call call_af239bfb8f1e45c29d79a1f6) | invalid: the decision request options or objects are invalid | 无理由 | - | 待定 |
| 2026-11-26T18:55:15.712Z | E05 | tool ask_person (call call_07c03820f7274bfc8aad904b) | invalid: the decision request options or objects are invalid | 无理由 | - | 待定 |
| 2026-11-26T18:55:22.130Z | E05 | tool ask_person (call call_c2dd14d63cf14649b0a57737) | invalid: the decision request options or objects are invalid | 无理由 | - | 待定 |
| 2026-11-26T18:55:26.912Z | E05 | tool read_user_decision (call call_20fdcdc383b949c0907988ae) | invalid_arguments: 工具参数不符合 schema：source: Unrecognized keys: "goalRef", "workspaceRef" | 无理由 | - | 待定 |
| 2026-11-26T18:58:03.578Z | E05 | tool find_graph (call call_5e84e569d69f4f8d87deef24) | invalid: a text search term must not contain whitespace | 产品规则 | - | 待定 |
| 2026-11-26T18:58:05.884Z | E05 | tool find_graph (call call_11bb461a1f614ee59767a106) | invalid_arguments: 工具参数不符合 schema：needle: Invalid input: expected string, received undefined; (根): Unrecognized keys: "memory", "v" 或 memory.v: Invalid input: expected 1; (根): Unrecognized key: "v" | 无理由 | - | 待定 |
| 2026-11-26T18:58:14.865Z | E05 | tool record_note (call call_f84e481e3870478892b47643) | invalid_arguments: 工具参数不符合 schema：op: Invalid discriminator value. Expected 'write' \| 'withdraw' | 无理由 | - | 待定 |
| 2026-11-26T18:59:24.399Z | E05 | core/goals/overlap-release | invalid: the overlap gate is already satisfied | 无理由 | - | 待定 |
| 2026-11-26T18:59:40.083Z | E05 | tool look_graph (call call_a53362ff199147c196f9e01e) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-26T19:01:13.413Z | E08 | tool read (call call_5f9284ebd02e4706a32b08f7) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-26T19:01:27.892Z | E08 | tool submit_initial_plan (call call_00ba2a3336474ee8a7d353c8) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-26T19:01:50.456Z | E08 | core/goals/confirm-draft confirm-again-mwxx5gc8-40 | revision_conflict: the draft already created a goal; one card never makes two goals | 协调 | expected | 待定 |
| 2026-11-26T19:01:50.484Z | E08 | core/goals/control goals-control-mwxx5gd0-41 | invalid: meta.expected must pin the Goal and its GoalPhase (0 = none stored) | 产品规则 | expected | 待定 |
| 2026-11-26T19:02:38.330Z | E08 | tool submit_plan_round (call call_7b764a714f5e4cbb90ef7711) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase" | 无理由 | - | 待定 |
| 2026-11-26T19:02:42.090Z | E08 | tool edit (call call_7758ac975e284d10bf119746) | execution_failed: test/mul.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-26T19:08:43.816Z | E09 | tool submit_initial_plan (call call_30a43243bada4447b3a7a67f) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined; plan: Unrecognized keys: "summary", "plan", "setup"; setup: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-26T19:08:58.655Z | E09 | tool submit_initial_plan (call call_7ea7c7ad33544001bfd4be2a) | invalid_arguments: 工具参数不符合 schema：plan: Invalid input: expected object, received undefined; (根): Unrecognized keys: "stages", "tasks", "obligations", "taskHierarchy", "executionDag", "taskRelations", "assignments" | 无理由 | - | 待定 |
| 2026-11-26T19:09:11.476Z | E09 | tool submit_initial_plan (call call_91b4798a02244889942caa11) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-26T19:09:27.913Z | E09 | tool submit_initial_plan (call call_12c1fc41cb0e4ef7a4bce3f3) | invalid_arguments: 工具参数不符合 schema：setup.checks.2.kind: Invalid option: expected one of "static"\|"dynamic" | 无理由 | - | 待定 |
| 2026-11-26T19:09:48.945Z | E09 | tool submit_secretary_answer (call call_affdda5c90694d1ba79a5078) | invalid_arguments: 工具参数不符合 schema：ideas: Invalid input: expected array, received undefined | 无理由 | - | 待定 |
| 2026-11-26T19:10:26.915Z | E09 | tool respond_session_message (call call_4a8e5a06faf0495792b99b3f) | invalid: the message ref is outside the bound project/workspace | 无理由 | - | 待定 |
| 2026-11-26T19:11:23.469Z | E09 | tool read (call call_dc5cbcf00e014322b09a0c82) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-26T19:11:27.470Z | E09 | tool look_graph (call call_ecd42dd3ea55462e86ae220f) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-26T19:11:47.893Z | E09 | tool edit (call call_8afc97ecce6c4976ba6b034e) | invalid_arguments: 工具参数不符合 schema：expectedRevision: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-26T19:12:01.166Z | E09 | tool edit (call call_e41d2ba838f841728228ec67) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 无理由 | - | 待定 |
| 2026-11-26T19:12:02.664Z | E09 | tool record_note (call call_9570c28c4ae94b01bd7dcd44) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "facets" | 无理由 | - | 待定 |
| 2026-11-26T19:12:07.200Z | E09 | tool edit (call call_c349fae366054a2c8627216f) | execution_failed: test/api.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-26T19:12:39.201Z | E09 | tool run_readonly_command (call call_18c2b701f68b42d6acde139a) | execution_failed: workspace_changed_during_readonly_command: the workspace was changed by another writer during the command; the changed paths are in the output | 无理由 | - | 待定 |
| 2026-11-26T19:12:59.210Z | E09 | tool edit (call call_440265b2fe6443279947bb6f) | invalid_arguments: 工具参数不符合 schema：expectedRevision: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-26T19:13:05.760Z | E09 | tool respond_session_message (call call_27e11e5142e6490b943d603d) | forbidden: 这条消息由这一轮的结论回复；要先说进度，另发一条不要回复的 | 无理由 | - | 待定 |
| 2026-11-26T19:13:41.659Z | E12 | tool run_readonly_command (call call_d927d97052bf4fc5a7e4603b) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-26T19:13:53.645Z | E12 | tool submit_initial_plan (call call_853c33b711874cbcb8622690) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-26T19:14:02.852Z | E12 | tool submit_initial_plan (call call_1f3cceb8ad024725adb2bb1e) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; setup.checks.0.kind: Invalid option: expected one of "static"\|"dynamic"; setup.checks.1.kind: Invalid option: expected one of "static"\|"dynamic"; planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-26T19:14:12.018Z | E12 | tool submit_initial_plan (call call_4c4b8f618a11477f911d7161) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-26T19:15:19.766Z | E12 | tool edit (call call_d73c5030a6654c5ba8a475f2) | execution_failed: test/greet.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-26T19:15:20.762Z | E12 | tool read (call call_45dc1889ac5442c59e7bf63e) | execution_failed: test 不存在 | 无理由 | - | 待定 |
| 2026-11-26T19:15:25.460Z | E12 | tool edit (call call_c169f162e204439a8369ca85) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 无理由 | - | 待定 |
| 2026-11-26T19:17:46.675Z | E12 | tool query_task_graph (call call_26bfb4c2aaf9467f9da63dac) | execution_failed: the requested plan record does not exist | 无理由 | - | 待定 |
| 2026-11-26T19:17:54.238Z | E12 | tool submit_plan_round (call call_9bc440df332c4008989a12d3) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-26T19:50:58.337Z | iteration | tool submit_initial_plan (call call_047148f00d7140edbe68204e) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-26T19:51:07.535Z | iteration | tool submit_initial_plan (call call_2bc3879666c441c289598124) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-26T19:51:15.452Z | iteration | tool submit_initial_plan (call call_70ba042eb72143adb60af014) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-26T19:52:55.147Z | iteration | tool submit_plan_round (call call_b8f014b9d8564f9bbccce087) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-26T19:53:04.116Z | iteration | tool submit_plan_round (call call_ff71f6afd69541eb9996965e) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "checks" | 无理由 | - | 待定 |
| 2026-11-26T19:53:12.998Z | iteration | tool submit_plan_round (call call_d7e3ce4ce24d4267a6b6fe93) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-26T19:53:31.838Z | iteration | tool read (call call_c09061ed6cf04cb5a4b1a78c) | execution_failed: cli.js 不存在 | 无理由 | - | 待定 |
| 2026-11-26T19:53:31.854Z | iteration | tool read (call call_47de37d6ec9f4f3ab17566eb) | execution_failed: cli.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-26T19:54:49.180Z | iteration | core/goals/control goals-control-mwxz1l24-72 | revision_conflict: the GoalPhase changed since the caller read it | 协调 | - | 待定 |
| 2026-11-26T19:54:57.864Z | intervention | tool look_graph (call call_258347c3b1b14e3380bb6e07) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-26T19:55:06.643Z | intervention | tool submit_initial_plan (call call_22ca8f8bcba545dabcd0c61e) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-26T19:55:56.939Z | intervention | tool edit (call call_e46fb772ab934ec8a3ad72c2) | execution_failed: test/lower.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-26T19:55:59.998Z | intervention | tool read (call call_f12c531b768a42ec87050da1) | execution_failed: test 不存在 | 无理由 | - | 待定 |
| 2026-11-26T19:56:47.896Z | intervention | tool submit_secretary_answer (call call_eba76227d68e40f087be3f09) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized keys: "answerKind", "planDraftIndex", "setup", "planRevisionId", "segment", "summary" | 无理由 | - | 待定 |
| 2026-11-26T19:57:16.675Z | intervention | tool submit_secretary_answer (call call_b8d968f203f84351b239d998) | invalid_arguments: 工具参数不符合 schema：goalCardDrafts.0.objective: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-26T19:57:49.096Z | intervention | tool submit_plan_round (call call_7b1ac5aa464b4c2e8fe7ff44) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase"; plan.tasks.3: Unrecognized key: "phase"; plan.tasks.4: Unrecognized key: "phase" | 无理由 | - | 待定 |
| 2026-11-26T19:58:42.192Z | intervention | tool read_session_message_body (call call_ed94745539d047dd85d53fff) | execution_failed: the requested mailbox record does not exist | 无理由 | - | 待定 |
| 2026-11-26T19:58:55.595Z | intervention | tool record_note (call call_98677419524849b9b10b2682) | invalid_arguments: 工具参数不符合 schema：op: Invalid discriminator value. Expected 'write' \| 'withdraw' | 无理由 | - | 待定 |
| 2026-11-26T23:30:17.866Z | waiting | tool read (call call_8b0bc12eb3034f0bb285611d) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-26T23:30:28.092Z | waiting | tool submit_initial_plan (call call_359efcabf7954c3f9bd19bb8) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-26T23:30:34.966Z | waiting | tool submit_initial_plan (call call_56c6d75f329c4ed49f141ae3) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-26T23:30:41.975Z | waiting | tool submit_initial_plan (call call_4f215ffeed49459ea17080ca) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "plannedFile" | 无理由 | - | 待定 |
| 2026-11-26T23:30:48.217Z | waiting | tool submit_initial_plan (call call_5ba112d7e59148248f3d59aa) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-26T23:30:52.859Z | waiting | tool submit_initial_plan (call call_8c2de99512474383bd17cffb) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-26T23:31:05.978Z | waiting | tool submit_secretary_answer (call call_f5f8feb5d6944cea8fe49952) | invalid_arguments: 工具参数不符合 schema：ideas: Invalid input: expected array, received undefined | 无理由 | - | 待定 |
| 2026-11-26T23:36:47.581Z | waiting | tool read_session_message_body (call call_284eb84ca5b7422cb69498e2) | execution_failed: the requested mailbox record does not exist | 无理由 | - | 待定 |
| 2026-11-26T23:37:48.997Z | waiting | tool list_files (call call_eb0b6f3b30f14246a8da5edd) | execution_failed: ENOENT: no such file or directory, open '/proc/self/fd/87/test' | 无理由 | - | 待定 |
| 2026-11-26T23:37:52.185Z | waiting | tool edit (call call_f0a272633a90410b9d06a887) | execution_failed: test/triple.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-26T23:38:10.161Z | waiting | tool read_user_decision (call call_e9671ea986e24094ae65afd1) | invalid: the decision source key is not parseable JSON | 无理由 | - | 待定 |
| 2026-11-26T23:38:47.271Z | waiting | tool ask_person (call call_a2dab2f434c94b90a48866ad) | revision_conflict: a decision object changed since it was read | 协调 | - | 待定 |
| 2026-11-27T00:37:42.585Z | C-216 | tool submit_initial_plan (call call_87ae2542cf374f54a33e2c16) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined; setup: Invalid input: expected object, received undefined; planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-27T00:37:50.521Z | C-216 | tool submit_initial_plan (call call_0c8b74a10aa143f2b99e0e06) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T00:37:58.797Z | C-216 | tool submit_initial_plan (call call_17fdab0ac4024b3ea82a6ad3) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T00:38:07.399Z | C-216 | tool submit_initial_plan (call call_a45ce42f846d4ba9a44a3706) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T00:38:20.233Z | C-216 | tool submit_initial_plan (call call_f4b22568c9064ec0a04e5473) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:38:29.679Z | C-216 | tool submit_initial_plan (call call_3d79716b2b3a415b9f52cfe0) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T00:38:41.720Z | C-216 | tool submit_initial_plan (call call_f39a13b2480e43d5a38d1194) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:38:46.440Z | C-216 | tool submit_initial_plan (call call_d95ba61e823644b4a369387e) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:38:48.839Z | C-216 | tool submit_initial_plan (call call_3d744f512d7b489e82f985e8) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:38:54.197Z | C-216 | tool submit_initial_plan (call call_e5b7126792c846d3a9e52821) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:38:58.300Z | C-216 | tool submit_initial_plan (call call_84f3c1b797d14e9cbc392b29) | invalid_arguments: 工具参数不符合 schema：setup.checks.0.kind: Invalid option: expected one of "static"\|"dynamic"; setup.checks.1.kind: Invalid option: expected one of "static"\|"dynamic" | 无理由 | - | 待定 |
| 2026-11-27T00:39:20.449Z | C-216 | tool submit_plan_round (call call_294a1ae25b2549a1abf5b79f) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T00:39:24.085Z | C-216 | tool submit_plan_round (call call_85ca851ac64e45b282da28aa) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T00:39:31.973Z | C-216 | tool submit_plan_round (call call_b46cb3747b244f3db56f154e) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0.taskKind: Invalid discriminator value. Expected 'work' \| 'gate'; plan.tasks.1.taskKind: Invalid discriminator value. Expected 'work' \| 'gate' | 无理由 | - | 待定 |
| 2026-11-27T00:39:40.014Z | C-216 | tool submit_plan_round (call call_b33a7b821dbf41ad9c255439) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:39:47.875Z | C-216 | tool submit_plan_round (call call_edaf0d7226964ab3aabfe19f) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:40:51.019Z | C-221 | tool read (call call_d9238223725448c19d7eacb0) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-27T00:41:07.265Z | C-221 | tool submit_initial_plan (call call_bc7c19eb37464500a022b9e1) | invalid_arguments: 工具参数不符合 schema：setup.architecture: Unrecognized key: "containment" | 无理由 | - | 待定 |
| 2026-11-27T00:41:18.423Z | C-221 | tool submit_initial_plan (call call_28115d1f41744e8092e52e1f) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:42:06.813Z | C-221 | tool list_files (call call_f5c62a3849d84abfb936884e) | invalid_arguments: 工具参数不符合 schema：prefix: Too small: expected string to have >=1 characters; prefix: Use a workspace-relative path | 无理由 | - | 待定 |
| 2026-11-27T00:42:10.541Z | C-221 | tool shell (call call_1e50e63bf4f54062b3548f11) | execution_failed: shell 退出码 2 | 无理由 | - | 待定 |
| 2026-11-27T00:42:14.263Z | C-221 | tool submit_plan_round (call call_8740d6353a514b98b3e367fa) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase"; plan.tasks.3: Unrecognized key: "phase" | 无理由 | - | 待定 |
| 2026-11-27T00:42:24.668Z | C-221 | tool edit (call call_e7e7665511054a45a5482d83) | execution_failed: test/fizzbuzz.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T00:43:00.631Z | C-222 | tool run_readonly_command (call call_9c695dff895a4d1fa45d306a) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |
| 2026-11-27T00:43:12.829Z | C-222 | tool submit_initial_plan (call call_4cf4b87243d64e3dbadaea26) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:44:01.859Z | C-222 | tool read (call call_e2eb3b87c0d8468687448d79) | execution_failed: .workbench 不是普通文件 | 无理由 | - | 待定 |
| 2026-11-27T00:44:19.594Z | C-222 | tool edit (call call_48e34451049a4f7e96d8b175) | execution_failed: test/shapes.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T00:44:59.127Z | B06 | tool submit_initial_plan (call call_3bf946c028b64cac8334e69a) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:46:04.231Z | B06 | tool dispatch_task (call call_2251f2408aa24534a10f6e1a) | busy: the Task is in progress; its lease is still held by a running Run | 协调 | - | 待定 |
| 2026-11-27T00:47:44.660Z | B06 | tool read (call call_1d2bfdb3d43c4e60a9f4a09b) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-27T00:48:50.132Z | B06 | tool submit_initial_plan (call call_2b4cc9491fc9433da35394b3) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized keys: "setup", "goalCardDrafts", "planDraftIndex"; setup: Invalid input: expected object, received undefined; goalCardDrafts: Invalid input: expected array, received undefined; planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-27T00:48:59.111Z | B06 | tool submit_initial_plan (call call_d097c5f344244ed99ea99b15) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:50:27.467Z | E08b | tool read (call call_a85fdaaefbb949b28f368598) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-27T00:50:27.615Z | E08b | tool run_readonly_command (call call_8e3667fe69b34455adb48038) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-27T00:50:44.159Z | E08b | tool submit_initial_plan (call call_c03cfdcd2d804a8ea2f434e6) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:50:58.023Z | E08b | tool submit_initial_plan (call call_d14174f815b04d1c9324fe99) | invalid_arguments: 工具参数不符合 schema：plan.obligations.0.verificationRequirements.0: Unrecognized key: "readPaths"; planDraftIndex: Invalid input: expected number, received undefined | 产品规则 | - | 待定 |
| 2026-11-27T00:51:08.701Z | E08b | tool submit_initial_plan (call call_87b41542bad243d7b12809c9) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:52:39.200Z | E08b | tool read (call call_bdb39ce4bfbb427083000f68) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-27T00:52:41.009Z | E08b | tool read (call call_e4f0d8b02a1741bdb5472356) | execution_failed: test 不存在 | 无理由 | - | 待定 |
| 2026-11-27T00:52:43.600Z | E08b | tool edit (call call_be72822675f94497990e7b87) | execution_failed: test/sub.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T00:52:46.370Z | E08b | tool edit (call call_df5677c7d19b41a8951c37f9) | execution_failed: calc.js 已被其他操作修改 | 无理由 | - | 待定 |
| 2026-11-27T00:52:58.840Z | E08b | tool record_note (call call_146e4d49a97c4f59931b3d91) | invalid_arguments: 工具参数不符合 schema：op: Invalid discriminator value. Expected 'write' \| 'review' \| 'withdraw' | 无理由 | - | 待定 |
| 2026-11-27T00:53:14.885Z | E08b | tool submit_plan_round (call call_3c8a4d3367fc480da41f9c02) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0.taskKind: Invalid discriminator value. Expected 'work' \| 'gate'; plan.tasks.1.taskKind: Invalid discriminator value. Expected 'work' \| 'gate' | 无理由 | - | 待定 |
| 2026-11-27T00:53:25.725Z | E08b | tool submit_plan_round (call call_6e69e70dc1584f929995fc90) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0.requirementLevel: Invalid option: expected one of "required"\|"optional"; plan.tasks.0.scope: Invalid input: expected object, received undefined; plan.tasks.1.requirementLevel: Invalid option: expected one of "required"\|"optional"; plan.tasks.1.scope: Invalid input: expected object, received undefined | 产品规则 | - | 待定 |
| 2026-11-27T00:53:36.204Z | E08b | tool submit_plan_round (call call_481ce4c79b2548a59b546c74) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:53:52.528Z | E08b | tool submit_plan_round (call call_6f18c9e0c97b4487948edbfd) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:54:04.614Z | E08b | tool submit_plan_round (call call_285e7fb83523429aaeafd844) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T00:54:15.336Z | E08b | core/goals/control goals-control-mwy9qnu0-163 | revision_conflict: the GoalPhase changed since the caller read it | 协调 | - | 待定 |

每次拒绝一行：HTTP 拒绝（预期的也记，标 expected）和公开原历史里的每次工具拒绝（按调用身份去重），原文不截断。类别只认依据：busy/revision_conflict/idempotency_conflict/source_stale/capacity 记协调；理由点到不可逆、外部或秘密的记安全；理由点到规则的记产品规则；其余记“无理由”。

## A/B、压缩、附加格、B06

### A1：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId 19833626-e5eb-4ae4-89c0-1b2fab2b54c2）
- usage（C-214）：pass。usageStatus reported，输入 34890，输出 106，缓存命中 32384
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 106 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"19833626-e5eb-4ae4-89c0-1b2fab2b54c2","reservedOutput":131072,"usageStatus":"reported","inputTokens":34890,"outputTokens":106,"cachedInputTokens":32384},{"requestId":"83cc96c1-7c1c-47fe-9a60-c0a8aa303096","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request 83cc96c1-7c1c-47fe-9a60-c0a8aa303096: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId 46cf552d-d002-4282-bf02-5c740af02889）
- usage（C-214）：pass。usageStatus reported，输入 12982，输出 182，缓存命中 10752
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 182 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"46cf552d-d002-4282-bf02-5c740af02889","reservedOutput":64000,"usageStatus":"reported","inputTokens":12982,"outputTokens":182,"cachedInputTokens":10752},{"requestId":"c2b78cd5-dff3-4b10-944a-d45926e219d3","reservedOutput":63818,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request c2b78cd5-dff3-4b10-944a-d45926e219d3: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### 压缩：pass

- compacted（K2-P2）：pass。context_compacted 3 条（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjhkYjk1NDBmMTc4ODNmOTA1MDc0MTQ1MzA0MjNkYmUzIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0xNzNmYjY4ZWI2ZjlhYzZlYmQ3YzQ0OTRhMDE0M2EzYmMyNzFkYWFhZGVkOTczMzM2Mjk3MDllODYxY2Y0ZmI0In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03NzJhNWYwODg2ZTg0Y2ZiYWQ1NDAxNDNlODA5MjkwYyIsImsiOiJzZXNzaW9uLTE3M2ZiNjhlYjZmOWFjNmViZDdjNDQ5NGEwMTQzYTNiYzI3MWRhYWFkZWQ5NzMzMzYyOTcwOWU4NjFjZjRmYjQiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1Ijo5NywibCI6MSwiaSI6NTR9:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjhkYjk1NDBmMTc4ODNmOTA1MDc0MTQ1MzA0MjNkYmUzIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0xNzNmYjY4ZWI2ZjlhYzZlYmQ3YzQ0OTRhMDE0M2EzYmMyNzFkYWFhZGVkOTczMzM2Mjk3MDllODYxY2Y0ZmI0In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03NzJhNWYwODg2ZTg0Y2ZiYWQ1NDAxNDNlODA5MjkwYyIsImsiOiJzZXNzaW9uLTE3M2ZiNjhlYjZmOWFjNmViZDdjNDQ5NGEwMTQzYTNiYzI3MWRhYWFkZWQ5NzMzMzYyOTcwOWU4NjFjZjRmYjQiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1Ijo5NywibCI6MSwiaSI6NzJ9:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjhkYjk1NDBmMTc4ODNmOTA1MDc0MTQ1MzA0MjNkYmUzIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0xNzNmYjY4ZWI2ZjlhYzZlYmQ3YzQ0OTRhMDE0M2EzYmMyNzFkYWFhZGVkOTczMzM2Mjk3MDllODYxY2Y0ZmI0In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03NzJhNWYwODg2ZTg0Y2ZiYWQ1NDAxNDNlODA5MjkwYyIsImsiOiJzZXNzaW9uLTE3M2ZiNjhlYjZmOWFjNmViZDdjNDQ5NGEwMTQzYTNiYzI3MWRhYWFkZWQ5NzMzMzYyOTcwOWU4NjFjZjRmYjQiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1Ijo5NywibCI6MSwiaSI6ODR9:summary）
- six-sections（K2-P2）：pass。摘要（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjhkYjk1NDBmMTc4ODNmOTA1MDc0MTQ1MzA0MjNkYmUzIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0xNzNmYjY4ZWI2ZjlhYzZlYmQ3YzQ0OTRhMDE0M2EzYmMyNzFkYWFhZGVkOTczMzM2Mjk3MDllODYxY2Y0ZmI0In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03NzJhNWYwODg2ZTg0Y2ZiYWQ1NDAxNDNlODA5MjkwYyIsImsiOiJzZXNzaW9uLTE3M2ZiNjhlYjZmOWFjNmViZDdjNDQ5NGEwMTQzYTNiYzI3MWRhYWFkZWQ5NzMzMzYyOTcwOWU4NjFjZjRmYjQiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1Ijo5NywibCI6MSwiaSI6NTR9）2602 字；缺的段：无
- accepted（K2-P2）：pass。摘要后第一次请求 a2ed8227-9078-40e9-96d7-d47d34ea2e14：usage reported（那一轮之后 closed，close invalid_answer，另记）
- cache-after（K2-P2）：pass。摘要后第一次请求 a2ed8227-9078-40e9-96d7-d47d34ea2e14：输入 35025，缓存命中 0（只量，不承诺）
- 秘书线 5 轮；压缩记录 compacted/summary, compacted/summary, compacted/summary；触发 0.02、目标 0.01

### C-216：fail

- observed-start（C-216）：fail。采用的架构模块路径：无
- adopted-done（C-216）：pass。Goal COMPLETED
- cold start: round c1ea8b37-a6c6-4a37-8801-53bc4ad8bf04 asked the person questions (needs_decision) instead of a plan; the person answered on the request

### C-221：uncovered

- first-plan（C-221）：pass。首案采用 initial-plan-82d23180f7228844c3420d26e7cb120e
- fail-rework（C-221）：uncovered (not-run)。没有同一 Task 上“检查轮 FAIL → 返工的新 Run → 检查轮 PASS”这条链（真实模型一次做对，不伪造失败）
- delivered（C-221）：pass。Goal COMPLETED

### C-222：pass

- created（C-222）：pass。secretaryCreated 的线：session-dc9bdd19c9961ddaab33f550d70b480f2257ea80ee7883768b90c61d5e961946
- started（C-222）：pass。建出的线上 Run：1496baf5-5b9c-4341-a103-f1455abe07f4/completed；Goal COMPLETED；null

### B06：pass

- W1a（B06-W1a）：pass。witness PASS/matched；Task satisfied；Goal PAUSED；报告 633 字
- W2（B06-W2）：pass。witness FAIL；Task running
- W3（B06-W3）：pass。witness FAIL；Task failed
- W5（B06-W5）：pass。非 Git：witness INCONCLUSIVE/matched；Task blocked
- W10（B06-W10）：pass。witness PASS，witness 要求由 platform:witness 覆盖：true；reviewer 要求 pass，覆盖它的检查 无（由独立审阅回答）；Task satisfied
- W12（B06-W12）：pass。四段：task 有 → round 有 → evidence 2 → material keys reportText,roundRef,subjectRunRef
- explore（B06-cond3）：pass。没写 witness 要求的 explore：计划被收下，轮 finalized，没有 platform:witness 检查
- cancel 1f12e883-8156-47ab-b640-b1a4b67d27bf: submit committed, deliver ready  
- B06-W1b、W4、W6、W8、W11、W13 和条件 1 引 B06 G2 的绿测（f580d77e，决定 121-122），G6 不重跑；第 9 片审阅的通过不写成 B06 通过。

### E08b：fail

- sub-running（C-210）：pass。提交改需求时 sub（t-sub）的 Run 2d517159-1a80-4834-964c-36e59ba26c44 正在跑（开始于 2026-11-27T00:52:37.064Z）
- stop-delivered（C-210）：uncovered (not-run)。秘书没有对 sub 发 request_stop（skill-platform-secretary.txt:32-33 的配方），叫停这一支没走到；任务卡 stop.steps：无；请求 无
- safe-point-end（C-210）：uncovered (not-run)。没有叫停请求，“安全点收尾”无从观察；sub 的 Run completed @ 2026-11-27T00:52:51.459Z；采用时 busy 0 次
- adopt-after-end（C-210）：fail。sub 的 Run 结束 2026-11-27T00:52:51.459Z；采用 initial-plan-6f577aad01998b9c335cffe1c5e92c7c @ 2026-11-27T00:54:15.227Z（人 plans/apply，busy 0 次）；采用版本的 dispositionRecord 里没有 sub 的记录
- the person selected idea 1 of 3 on the change: 按原话改：sub 取消，加 div + div.test.js（推荐）
- 采用前：叫停请求 无；任务卡上的步骤 无；sub 的 Run 已结束 2026-11-27T00:52:51.459Z（completed）
- goal-confirm:goal.confirmDraft:355b05b85d0c8c3866ddb4e8608272ed0175202596fb352a25e08a1d179da2d4 (RUNNING): pause because E08b ended: committed

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 34302597（输入 33932710，输出 369887；缓存命中 29611392）；Query 请求 506 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 39 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 实报输入（平台报了用量的部分，不含按预留上限计的和未计费 0）：33803019；估算部分 129691。
- 超预算退出：整轮 没有；按场景/格 没有。
- A1：用量 34996（输入 34890，输出 106，缓存命中 32384；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 34890）
- B1：用量 13164（输入 12982，输出 182，缓存命中 10752；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 12982）
- E05：用量 9734208（输入 9667383，输出 66825，缓存命中 8408064；Query 请求 128（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 6；实报输入 9667383）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 0）
- E08：用量 827821（输入 816849，输出 10972，缓存命中 650240；Query 请求 15（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 816849）
- E09：用量 6865176（输入 6799660，输出 65516，缓存命中 6216576；Query 请求 104（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 6799660）
- E12：用量 1567860（输入 1551385，输出 16475，缓存命中 1267072；Query 请求 20（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1551385）
- iteration：用量 1541122（输入 1517624，输出 23498，缓存命中 1263744；Query 请求 27（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1517624）
- intervention：用量 2781216（输入 2746702，输出 34514，缓存命中 2437248；Query 请求 44（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 2746702）
- waiting：用量 2474681（输入 2437485，输出 37196，缓存命中 2116864；Query 请求 29（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 1：Query 已关闭、用量未知），结束的 Run 7；实报输入 2387035）
- C-216：用量 1674771（输入 1648742，输出 26029，缓存命中 1445504；Query 请求 33（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1648742）
- C-221：用量 1190047（输入 1173929，输出 16118，缓存命中 1036800；Query 请求 11（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1173929）
- C-222：用量 650565（输入 643958，输出 6607，缓存命中 529664；Query 请求 11（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 643958）
- B06：用量 2294697（输入 2273822，输出 20875，缓存命中 1970688；Query 请求 36（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 10；实报输入 2194581）
- E08b：用量 2006959（输入 1976813，输出 30146，缓存命中 1757440；Query 请求 27（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1976813）
- compaction：用量 645314（输入 630486，输出 14828，缓存命中 468352；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 630486）
- P6 记账：模型调用 678 次（公开原历史里 `model.request_started` 的条数，含 Work Run；压缩摘要的请求在另一个 Kernel Session 里，数不到，照旧记作缺口）；叫醒轮（intervention-planning）36 个，其中只回“收到”的 3 个（成功的工具调用只有读类和答复，且答复的都不是要回复的信，没交候选、没发信、没出卡；裁定 Q11、lead 11-25 #31，只计数不判；回复对象读不到的照旧计数，见其它记录）。
- A1：模型调用 2，叫醒轮 1，只回收到 1
- B1：模型调用 2，叫醒轮 1，只回收到 0
- E05：模型调用 167，叫醒轮 13，只回收到 1
- E08：模型调用 23，叫醒轮 1，只回收到 0
- E09：模型调用 80，叫醒轮 2，只回收到 0
- E12：模型调用 39，叫醒轮 1，只回收到 0
- iteration：模型调用 33，叫醒轮 1，只回收到 0
- intervention：模型调用 65，叫醒轮 4，只回收到 0
- waiting：模型调用 55，叫醒轮 5，只回收到 1
- C-216：模型调用 38，叫醒轮 1，只回收到 0
- C-221：模型调用 33，叫醒轮 1，只回收到 0
- C-222：模型调用 19，叫醒轮 1，只回收到 0
- B06：模型调用 64，叫醒轮 3，只回收到 0
- E08b：模型调用 44，叫醒轮 1，只回收到 0
- compaction：模型调用 14，叫醒轮 0，只回收到 0

## 延迟探针

- wa#0：{"startedAt":"2026-11-26T18:45:15.828Z","writtenAt":"2026-11-26T18:46:30.054Z","samples":3463,"p50Ms":20.22,"p95Ms":21,"p99Ms":41.78,"maxMs":560.99,"meanMs":21.51}；关闭 SIGINT, exit 0 after 96 ms
- wb#0：{"startedAt":"2026-11-26T18:46:30.208Z","writtenAt":"2026-11-26T18:47:44.092Z","samples":3462,"p50Ms":20.22,"p95Ms":21.18,"p99Ms":44.27,"maxMs":446.69,"meanMs":21.57}；关闭 SIGINT, exit 0 after 48 ms
- w-accept#0：{"startedAt":"2026-11-26T18:47:44.164Z","writtenAt":"2026-11-26T19:15:58.961Z","samples":75422,"p50Ms":20.23,"p95Ms":21.09,"p99Ms":114.56,"maxMs":3191.87,"meanMs":23.22}；关闭 SIGINT, exit 0 after 356 ms
- w-accept#1：{"startedAt":"2026-11-26T19:15:59.117Z","writtenAt":"2026-11-26T23:32:10.683Z","samples":768389,"p50Ms":20.35,"p95Ms":21.27,"p99Ms":22.23,"maxMs":674.23,"meanMs":20.89}；关闭 SIGINT, exit 0 after 291 ms
- w-accept#2：{"startedAt":"2026-11-26T23:34:37.667Z","writtenAt":"2026-11-27T00:54:17.205Z","samples":237854,"p50Ms":21.09,"p95Ms":21.48,"p99Ms":22.3,"maxMs":719.32,"meanMs":21.24}；关闭 SIGINT, exit 0 after 262 ms
- compaction#0：{"startedAt":"2026-11-27T00:54:17.271Z","writtenAt":"2026-11-27T00:56:53.420Z","samples":7578,"p50Ms":21.1,"p95Ms":21.58,"p99Ms":36.31,"maxMs":469.76,"meanMs":21.71}；关闭 SIGINT, exit 0 after 54 ms

## 其它记录

- 2026-11-26T18:46:29.802Z A1: g6-a1-mwxwk8b6-4 (BLOCKED): pause because wa closes: committed
- 2026-11-26T18:46:29.871Z A1: A1: request 83cc96c1-7c1c-47fe-9a60-c0a8aa303096 counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-26T18:47:43.973Z B1: g6-b1-mwxwlulj-15 (BLOCKED): pause because wb closes: committed
- 2026-11-26T18:47:44.009Z B1: B1: request c2b78cd5-dff3-4b10-944a-d45926e219d3 counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-26T23:34:42.428Z waiting: waiting: request 62b7d63c-f50c-4adb-b2d4-f153419f805f counted at its reservation 50450+16384 (usage unknown; Query closed cancelled; counted at the reservation (upper bound))
- 2026-11-27T00:47:05.180Z B06: B06: Run 1f12e883-8156-47ab-b640-b1a4b67d27bf counted with its reported part only, the rest 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-27T00:56:53.436Z -: §6.2：Query 在“进入中”被中止由 qent 关成 not_entered（aborted_before_entry）；`queries/cancel` 在 entering 窗口仍回 not_running，本次不测、不判场景失败。
