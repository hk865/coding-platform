# G6 notes 2026-11-25（运行号 g6-2026-11-25-d6642f43）

## 逐场景判据

### E05：fail

- C 行：C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 4085528（含缓存命中），输出 26766，缓存命中 3460352，Query 请求 56。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| overlap | C-182, C-183, C-217 | fail | t-users 1 个 Run、t-orders 1 个 Run，没有一对在不同 Session 上时间重叠 |
| gate | C-185 | pass | 门：module src-entities，等待 t-orders，在跑 t-users/3296b1b5-c509-4551-afac-bf71fe639483；放行 注记或未放行 |
| paths | C-185, C-217 | pass | files/compare 给出：.workbench/notes/7cf5865d680ee57c3a3e5b47e6b7f103/2c367dd7-bdfb-4909-9758-1ab48db2572e.md, .workbench/notes/7cf5865d680ee57c3a3e5b47e6b7f103/3390c27f-68a2-4770-8797-86bb5ce2726b.md, .workbench/notes/7cf5865d680ee57c3a3e5b47e6b7f103/728a6250-7986-44e6-a56c-7f0737ee5cd5.md, .workbench/notes/7cf5865d680ee57c3a3e5b47e6b7f103/8d3685e2-096d-4c8e-8fa3-f916ac90c0ed.md, src/legacy/contact-check.js, src/legacy/is-email.js, src/orders.js, src/rules.js, src/users.js, test/orders.test.js, test/rules.test.js, test/users.test.js |
| kept | C-185 | pass | t-users satisfied，t-orders satisfied |
| single-occupancy | C-71 | pass | 2 个 Run，没有同 Session 时间重叠 |
| convention | C-208 | pass | rules.js 定义 isEmail：true；users/orders 都从 rules 引用 |
| duplicates | C-208 | fail | 成功的 project_source（duplicates:true）结果 0 个，候选 0 条，没有一条的两处位置之一是 src/legacy/contact-check.js |
| reviewer | C-208, C-218 | uncovered (entry-missing) | 接不上：轮 {"aggregateType":"VerificationRound","projectId":"8694c12ec0c4405e979b28a03d429111","workspaceId":"7cf5865d680ee57c3a3e5b47e6b7f103","goalId":"g6-e05-mwvgkdze-7","taskId":"t-users","runId":"3296b1b5-c509-4551-afac-bf71fe639483","roundId":"bbd713c9-f187-4a3d-b529-0f26650bfc70"} 没有可读的正式审阅 Evidence（审阅要求状态 pass） |
| name-different | C-208 | uncovered (entry-missing) | 接不上：轮 {"aggregateType":"VerificationRound","projectId":"8694c12ec0c4405e979b28a03d429111","workspaceId":"7cf5865d680ee57c3a3e5b47e6b7f103","goalId":"g6-e05-mwvgkdze-7","taskId":"t-users","runId":"3296b1b5-c509-4551-afac-bf71fe639483","roundId":"bbd713c9-f187-4a3d-b529-0f26650bfc70"} 没有可读的正式审阅 Evidence（审阅要求状态 pass） |
| name-same | C-208 | uncovered (entry-missing) | 接不上：轮 {"aggregateType":"VerificationRound","projectId":"8694c12ec0c4405e979b28a03d429111","workspaceId":"7cf5865d680ee57c3a3e5b47e6b7f103","goalId":"g6-e05-mwvgkdze-7","taskId":"t-users","runId":"3296b1b5-c509-4551-afac-bf71fe639483","roundId":"bbd713c9-f187-4a3d-b529-0f26650bfc70"} 没有可读的正式审阅 Evidence（审阅要求状态 pass） |
| temporary | C-208 | fail | 计划外的未跟踪文件：test/rules.test.js |
| line-choice | C-73, C-191 | uncovered (entry-missing) | 公开读口不给派工时的候选线和六键排序依据（lines/list 只给结果），驱动看不到排除和排序本身 |

- driver-start t-users: ready running
- driver-start t-orders: ready running
- driver-start goal: ready running
- planted src/legacy/contact-check.js: ready
- planted src/legacy/is-email.js: ready
- E05 Goal ended COMPLETED

### E06：fail

- C 行：C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 5820973（含缓存命中），输出 49270，缓存命中 5256960，Query 请求 55。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| handoff | C-219 | fail | the platform did not do it: timed out after 40 min waiting for a successor on the line |
| successor-input | C-75, C-209, C-219 | uncovered (not-run) | stopped before this check: timed out after 40 min waiting for a successor on the line |
| successor-frontier | C-75 | uncovered (not-run) | stopped before this check: timed out after 40 min waiting for a successor on the line |
| no-restatement | C-209 | uncovered (not-run) | stopped before this check: timed out after 40 min waiting for a successor on the line |
| excluded-path | C-209 | uncovered (not-run) | stopped before this check: timed out after 40 min waiting for a successor on the line |
| same-task-new-run | C-135 | uncovered (not-run) | stopped before this check: timed out after 40 min waiting for a successor on the line |
| history-continuity | C-106, C-194 | uncovered (not-run) | stopped before this check: timed out after 40 min waiting for a successor on the line |
| restart-running | C-149 | pass | 重启前 Run bf59e444-c943-41fd-8920-fb12e86dddb1 → crashed；继续的 Run 2adca42c-8466-4e72-8938-e6bf9cbc040a 在 session-128bdfaa048996b564c4a64fe25b2c38d6200a399de7cefc8aa63ff4b9f02246（原 session-128bdfaa048996b564c4a64fe25b2c38d6200a399de7cefc8aa63ff4b9f02246） |
| restart-paused | C-151 | uncovered (not-run) | stopped before this check: timed out after 40 min waiting for a successor on the line |
| archive | C-219 | uncovered (not-run) | stopped before this check: timed out after 40 min waiting for a successor on the line |
| hand-or-drop | C-223 | uncovered (not-run) | stopped before this check: timed out after 40 min waiting for a successor on the line |
| wake | C-68, C-181 | uncovered (not-run) | stopped before this check: timed out after 40 min waiting for a successor on the line |

- goal-confirm:goal.confirmDraft:39d4569dd24475f881b41ce0ebf4180a61092255fa88d2aeb46f4bbc99150ff8: the person selected idea 1 of 3 (A（推荐）：isEmail 内先判长度再跑正则，254 用具名常量)
- driver-start goal-confirm:goal.confirmDraft:39d4569dd24475f881b41ce0ebf4180a61092255fa88d2aeb46f4bbc99150ff8: ready running
- restart (Work Run running): SIGINT, exit 0 after 651 ms
- resumeOnStartup = ask
- after restart: NEEDS_DECISION/GOAL-30 causes [{"code":"interrupted_pending_resume","source":"host_restart","interruption":{"ref":{"aggregateType":"GoalInterruption","projectId":"8694c12ec0c4405e979b28a03d429111","goalId":"goal-confirm:goal.confirmDraft:39d4569dd24475f881b41ce0ebf4180a61092255fa88d2aeb46f4bbc99150ff8"},"revision":1},"close":"clean","detectedAt":"2026-11-25T01:49:21.853Z","taskIds":["t-len-limit","t-long-email-tests","gate-len-limit","gate"],"runRefs":[{"aggregateType":"Run","projectId":"8694c12ec0c4405e979b28a03d429111","goalId":"goal-confirm:goal.confirmDraft:39d4569dd24475f881b41ce0ebf4180a61092255fa88d2aeb46f4bbc99150ff8","runId":"bf59e444-c943-41fd-8920-fb12e86dddb1"}]},{"code":"auto_rework_pending","taskId":"t-len-limit","operation":"requeue","failureClass":"interrupted"}]
- 换手请求发给 session-128bdfaa048996b564c4a64fe25b2c38d6200a399de7cefc8aa63ff4b9f02246（在跑 Run 2adca42c-8466-4e72-8938-e6bf9cbc040a）：messages/send: committed (sendStatus sent)
- stopped: not-run: timed out after 40 min waiting for a successor on the line
- goal-confirm:goal.confirmDraft:39d4569dd24475f881b41ce0ebf4180a61092255fa88d2aeb46f4bbc99150ff8 (NEEDS_DECISION): pause because E06 ended: committed

### E08：fail

- C 行：C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210；自治档 `every_step`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 838491（含缓存命中），输出 10037，缓存命中 672896，Query 请求 13。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| autonomy-born | C-133a | pass | 草稿自治 every_step；Goal 生在版本 1，采用后读到 every_step |
| confirm-only-latest | C-47 | pass | 同一草稿换 commandId 再确认：rejected revision_conflict |
| person-adopts | C-46, C-52 | pass | 人确认之前 goals/list 里没有这个 Goal（0 个旧 Goal）；首方案由人 initialization/adopt |
| first-adoption | C-63, C-62 | pass | 采用回执 plan initial-plan-c515711c1f98d704fca4e988f5e36fb2；Goal 指针 {"aggregateType":"PlanRevision","projectId":"31329db18943537cb0be4fe414bf0af9","planId":"initial-plan-c515711c1f98d704fca4e988f5e36fb2"} |
| hold-before-adopt | C-210 | uncovered (not-run) | stopped before this check: timed out after 30 min waiting for the changed plan candidate |
| versions | C-210 | fail | the platform did not do it: timed out after 30 min waiting for the changed plan candidate |
| switch | C-210 | uncovered (not-run) | stopped before this check: timed out after 30 min waiting for the changed plan candidate |
| old-evidence | C-210 | uncovered (not-run) | stopped before this check: timed out after 30 min waiting for the changed plan candidate |
| required-cancel | C-210 | uncovered (not-run) | stopped before this check: timed out after 30 min waiting for the changed plan candidate |
| autonomy-later | C-126 | uncovered (not-run) | 草稿本来就是 every_step，这次没有中途改档 |
| control-pins | C-116, C-118 | pass | 只钉 Goal 的暂停：rejected invalid |

- first plan initial-plan-c515711c1f98d704fca4e988f5e36fb2: sub = t1-sub，mul = t2-mul
- 提交改需求时：mul 1 个 Run（starting），sub 0 个 Run；sub 的 dispatch.claimableNow null
- stopped: not-run: timed out after 30 min waiting for the changed plan candidate
- goal-confirm:goal.confirmDraft:b957c395df3c77ed7a134995b70140436ee8889143d9c30e3b160126e1ff3f82 (RUNNING): pause because E08 ended: committed

### E09：uncovered

- C 行：C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 2510181（含缓存命中），输出 28629，缓存命中 2188672，Query 请求 17。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| executor-reports | C-185, C-211 | pass | 执行者上报 session-message-a7d8e3f03662585311394b01af5c2e3e6db0e8503dd9f5b085bc95845af681e9（ask_copy（问参谋线的只读副本））：发件线 session-7120dbd4a1ea32b1c11a1ccd205effb8909c846c9b1a16680817f1a340271f88（work_run）→ 收件线 session-dc80b876363dc1c51fadff4f7f406357b6e7c3bf9a04040a91756edaf2591c8a（参谋），needsReply true，answeredBy copy；2026-11-25T03:06:51.310Z 答复，答复人 query_run/session-5927d75e0a25175e8a15acbc50076925bc022ee6278476585e74a3233932b7fb（?）；参数 {"line":{"projectId":"353cb76ed4b6aa19b55c8f1aef15947c","sessionId":"session-dc80b876363dc1c51fadff4f7f406357b6e7c3bf9a04040a91756edaf2591c8a"},"question":"关于 gate-contract-conflict（parseDate 返回值契约：Date 对象 vs {y,m,d}）：用户是否已经给出过明确答复（选哪个形态、原话是什么、在哪个时间点/哪条消息里）？如果还没有，请明确说“未收到用户答复”。我只依据已记录的用户答复动手，缺少答复就会停手。"} |
| adviser-explains | C-211 | pass | 上报 session-message-a7d8e3f03662585311394b01af5c2e3e6db0e8503dd9f5b085bc95845af681e9 是 ask_copy，由参谋线 session-dc80b876363dc1c51fadff4f7f406357b6e7c3bf9a04040a91756edaf2591c8a 的只读副本 session-5927d75e0a25175e8a15acbc50076925bc022ee6278476585e74a3233932b7fb 回答（判据来自副本历史 sessions/history 的轮 kturn-c9537e39a1af514df7557de875cd127f64681d3d6a025a7dabd57d5b83095e62）；回答同时点到 api.js 和 report.js：是 |
| person-decides | C-211, C-62 | uncovered (not-run) | 上报 session-message-a7d8e3f03662585311394b01af5c2e3e6db0e8503dd9f5b085bc95845af681e9 走的是 ask_copy，由参谋的只读副本回答；只读副本不出卡，要人定的事应由参谋线 ask_person。人决定和新版本这两环没有发生 |
| new-version | C-211, C-55 | uncovered (not-run) | 上报 session-message-a7d8e3f03662585311394b01af5c2e3e6db0e8503dd9f5b085bc95845af681e9 走的是 ask_copy，由参谋的只读副本回答；只读副本不出卡，要人定的事应由参谋线 ask_person。人决定和新版本这两环没有发生 |
| report-after-dispatch | C-185, C-211 | uncovered (not-run) | 同目标没有 agent 派活落实（任务卡 dispatch.request 没有 applied 的），这一支没走到 |
| diagnosis-reverify | C-211 | uncovered (not-run) | 3 个检查轮里没有一轮的重验以消息为依据（reverify.newInputRefs 没有 session_message），这一支没走到（可选） |
| formal-change | C-212 | pass | architecture/revise committed  ；目录版本 2 |
| drift | C-212, C-89 | pass | compare-formal 5 条 finding；带路径的：package.json, README.md, src/api.test.js, src/report.js, src/report.test.js |
| observation-after-adopt | C-65 | pass | 采用后观测 {"aggregateType":"ObservedArchitecture","projectId":"353cb76ed4b6aa19b55c8f1aef15947c","workspaceId":"eb9b4c2106ddba161af6f2213aba0dcc","captureId":"985841a4-8fc6-4ad7-92e8-9cc7a3dc34fa"} |
| observation-after-pass | C-98 | pass | 观测：采用后 {"aggregateType":"ObservedArchitecture","projectId":"353cb76ed4b6aa19b55c8f1aef15947c","workspaceId":"eb9b4c2106ddba161af6f2213aba0dcc","captureId":"985841a4-8fc6-4ad7-92e8-9cc7a3dc34fa"} → 现在 {"aggregateType":"ObservedArchitecture","projectId":"353cb76ed4b6aa19b55c8f1aef15947c","workspaceId":"eb9b4c2106ddba161af6f2213aba0dcc","captureId":"0c9ffcfa-8285-4f83-9063-a72d6082bf76"} |
| rounds | C-93, C-95, C-218 | pass | satisfied 任务的最新轮：task-a-parse-date PASS/gaps 0, task-b-month-of PASS/gaps 0, task-reconcile-contract PASS/gaps 0 |
| uncovered-round | C-99 | uncovered (not-run) | 这次没有出现缺覆盖（INCONCLUSIVE）的检查轮 |

- goal-confirm:goal.confirmDraft:49814034251b027b2fee2c3526d4a1bc3367ee17139766ff1dfb8a54e3b8a0b1: the draft chose every_step; set to after_plan_confirmation after adoption (committed )
- E09 Goal ended COMPLETED
- 8E contact 层：uncovered (8E optional)（只记在这里，不进 uncovered[]；9-start-rulings.frozen.md:966-967）

### E12：uncovered

- C 行：C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1193374（含缓存命中），输出 12630，缓存命中 1007872，Query 请求 17。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| reads-quiet | C-36 | pass | QueryRun 3→3，输入 392738→392738，changesHead h0000001037→h0000001037 |
| graph-cards | C-88, C-89 | pass | goal children 3，find 4，path 卡 有 |
| raw-history | C-42, C-157 | pass | 线的原历史 60 条，Run 历史 59 条 |
| completion-chain | C-104 | pass | 检查轮卡 2 张，有非空 evidenceRefs：true |
| restart-state | C-145, C-215 | pass | 重启后旧 Goal COMPLETED，计划 initial-plan-ceb5e5c8518073402e79fbc26f6c4ba9，Run 1/1 |
| reconcile | C-146 | pass | host/reconcile-report：lease owned |
| redrive-sets | C-155 | pass | 旧 Goal 的 causes：[{"code":"change_pending","proposalRef":{"aggregateType":"PlanProposal","projectId":"e5e131aaddcba0f89841383111b15892","workspaceId":"25bc37c62097016b6fc50edeb1f1d551","proposalId":"plan-proposal-5134 |
| new-goal | C-114, C-158 | pass | 新 Goal goal-confirm:goal.confirmDraft:e6722b93aa18965796d85c98830caa4baf8cb3c883f300b58c031e588f7600cd（采用 committed，起步时 3 个任务都没满足）→ COMPLETED；旧 Goal 仍 COMPLETED |
| history-reuse | C-220 | uncovered (not-run) | 新 Goal 的 Run 没有一个成功的工具结果引用旧 Goal 或旧 Run（这次新工作没有查询已完成工作） |
| stale-premise | C-220 | uncovered (entry-missing) | 适用范围和“过期前提不升级”是模型对已查到事实的取舍，公开读口没有逐项可判的字段，不判通过 |
| replay | C-147 | pass | 同一 flowId 两次 driver-start：ready/ready，state running/running |
| wait-registry | C-207 | uncovered (entry-missing) | 目标等待登记表只在 Host 内存里，没有公开读口；重启后只能看到它的效果（等待的线被叫醒），看不到登记表本身 |

- restart: SIGINT, exit 0 after 114 ms
- goal-confirm:goal.confirmDraft:e6722b93aa18965796d85c98830caa4baf8cb3c883f300b58c031e588f7600cd: the person selected idea 1 of 2 (farewell 与 greet 完全对称（默认）)

### iteration：pass

- C 行：C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1651711（含缓存命中），输出 26890，缓存命中 1416064，Query 请求 29。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ideas | C-108 | pass | 3 个思路，目标卡草稿 0 |
| select | C-109 | pass | select-idea queued；下一轮输入提到所选：true |
| candidate | C-110 | pass | 候选 plan-proposal-7093c1f71616d693e392f0f45d8447c9（candidate） |
| what-changed | C-213, C-110 | pass | 第二轮回答说明改动：true；新候选 plan-proposal-b931f60108141fa51e2932fd6cfcb5be，前一版 {"proposalRef":{"aggregateType":"PlanProposal","projectId":"7d9b60994a6f5fb9d4c1921ecfaad025","workspaceId":"b76a6be6b65c0281cd8ea8c687b4744b","proposalId":"plan-proposal-7093c1f71616d693e392f0f45d8447c9"},"revision":2} |
| per-request | C-111 | pass | 采用第一请求的候选 committed；第二请求候选 plan-proposal-917b73a300e9dbff87ac66be795c43e0 现在 stale |
| why | C-112, C-226 | pass | 追问后候选不变：true；回答 1748 字 |
| continues | C-105 | pass | 同一请求 3 轮，秘书 Session session-36718a95a26239ec98df9d40521ffaa61c1892fc00cc4ba74b2f9d29b6aff7d1 |
| request-goal | C-107 | pass | 请求记的目标 goal-confirm:goal.confirmDraft:e1dc117807d924a3b62ebb2bd386910864860502d9be294d97366b438d80df60 |
| cards-ask | C-113 | pass | 秘书线的 turn 输入带 ## Cards：true |
| multi-round | C-194 | pass | 后续轮的回答接上前面改过的内容（process.argv） |

- goal-confirm:goal.confirmDraft:e1dc117807d924a3b62ebb2bd386910864860502d9be294d97366b438d80df60 (RUNNING): pause because iteration ended: committed

### intervention：uncovered

- C 行：C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 2828688（含缓存命中），输出 32539，缓存命中 2501376，Query 请求 33。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ask-copy | C-198 | pass | 问一问 queued → answered；原线 Run ended/completed，输入含这个问题的轮 无；问件 session-message-6bdc551146f1f97c3022dcfcdcb9e282329d51227e159ed3a703a63cbb801d27 answeredBy copy，送进 无 |
| delivery-states | C-189, C-192 | pass | disposition 依次：offerable → delivered（发送回执 sent）；发信时在跑的 Run 379156f9-5ab5-41d4-ad89-124aeec268e1；送进 Run 379156f9-5ab5-41d4-ad89-124aeec268e1 |
| busy-original-words | C-189, C-199 | pass | 送进发信时在跑的 Run 379156f9-5ab5-41d4-ad89-124aeec268e1（接受于 2026-11-25T03:22:13.558Z）；这个 Run 输入含原话的轮：kturn-8c154092649882eb6bbabf1b0cc0815dcc1676a97d54726977efc1c35a404837 |
| continue-no-planning | C-199 | pass | 发送时线上当前任务 goal-confirm:goal.confirmDraft:456148d231c5d59f9a6d2ce65fc83099b2e52084169e9dba7a8791e9dd562498/t-truncate active/running；这条消息的 intervention_planning Query：没有 |
| planning-when-idle | C-199, C-200 | uncovered (not-run) | 长目标活跃期间没有出现“干过活的线上没有未完成任务”的时刻，没走到这个分支 |
| claim-once | C-199 | uncovered (not-run) | 长目标活跃期间没有出现“干过活的线空闲、它当前的任务没完成”的时刻，没走到这个分支 |
| four-endings | C-201, C-202, C-203 | uncovered (entry-missing) | “反问”“非法”两种收尾没有公开入口能造出；这次看到的结局：无 |
| review-packet | C-199 | uncovered (not-run) | 被 Run 接受的直接干预 2 条；审阅线 无；这个目标的 execreview 包 0 个；逐条：session-message-7d761450cec4f05c7db879e0de8bdea6a85eeddb9c7fe6f1befa291a0dc346ac（Run 379156f9-5ab5-41d4-ad89-124aeec268e1，任务 t-truncate）：没有对上这个任务和 Run 的审阅包；session-message-7e5b9f8f385481924863eb52ae2704299ac70a4769c03036bf4ff7c02c940455（Run a3fff6ca-c683-4f0b-ba1a-2556bb4bdf97，任务 t-capitalize）：没有对上这个任务和 Run 的审阅包（检查计划里没有审阅项时不出包） |
| completed-goal | C-114 | uncovered (not-run) | 干过已完成目标 goal-confirm:goal.confirmDraft:2e3c199ad1940cc6410d3eebabb366b5ee9694211cbaeb63fe85b256c291b05b 的线（session-ae992c4e0f816d180cb4115a193056b48c45143f2242836ad1716d37c2ccbe4f）现在的 latestWork 都不是它（被别的目标复用），发给它们的消息不会成为新目标请求 |
| paused-queues | C-197 | pass | 暂停 committed（目标当时 RUNNING）：暂停中 offerable；恢复 committed  后 delivered |

- goal-confirm:goal.confirmDraft:456148d231c5d59f9a6d2ce65fc83099b2e52084169e9dba7a8791e9dd562498: the person selected idea 1 of 3 (A｜三个任务串行，各自带测试（推荐）)
- driver-start goal-confirm:goal.confirmDraft:456148d231c5d59f9a6d2ce65fc83099b2e52084169e9dba7a8791e9dd562498: ready running
- 长目标结束 COMPLETED

### waiting：fail

- C 行：C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1323456（含缓存命中），输出 12604，缓存命中 1140480，Query 请求 22。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| wait-open | C-188, C-225 | pass | 成员 session-24660bf37010c4b1ae3b6c790a999913b9e814cc5811aa600c634b519c9a5b59 的 Work（Run 5a0d11fb-cc6a-48f5-be37-11242ab3b2d3）经工具发出等待 session-message-9f9f26ae5a027e641a486bec06b1fe0d5c64cea5d89508d9190d7058251231b9：收信人 session-a3f0c5e25149b1854756f0150ec7a1a7585d0b44b7b2ea51d68213e8a5f106d8，期限 2026-11-25T03:27:50.154Z，waitAfterSend true；发信的 Run 5a0d11fb-cc6a-48f5-be37-11242ab3b2d3 ended/yielded，continuation wait_reply → session-message-9f9f26ae5a027e641a486bec06b1fe0d5c64cea5d89508d9190d7058251231b9 |
| interject-keeps-wait | C-188, C-224 | pass | 插话 session-message-92bac055937f650fa999d2b5e71cd2df4147c5fa6a7f1cb23c0b5d9bdd37501f（sent）：接它的 Run 73442e11-5daa-4646-ab7c-850b5b01b4de（consumedWait intervention，在 session-24660bf37010c4b1ae3b6c790a999913b9e814cc5811aa600c634b519c9a5b59）；原等待 session-message-9f9f26ae5a027e641a486bec06b1fe0d5c64cea5d89508d9190d7058251231b9 answered，期限 2026-11-25T03:27:50.154Z（原 2026-11-25T03:27:50.154Z）；新中断通知 成员侧 1 条、秘书侧 1 条 |
| restart-kept | C-170, C-207 | uncovered (not-run) | stopped before this check: timed out after 20 min waiting for the expiry or the reply |
| expiry-once | C-171, C-190 | fail | the platform did not do it: timed out after 20 min waiting for the expiry or the reply |
| second-expiry | C-171, C-190, C-224 | uncovered (not-run) | stopped before this check: timed out after 20 min waiting for the expiry or the reply |
| consumes | C-187 | uncovered (not-run) | stopped before this check: timed out after 20 min waiting for the expiry or the reply |
| late-reply | C-224, C-189 | uncovered (not-run) | stopped before this check: timed out after 20 min waiting for the expiry or the reply |
| reply-first | C-187, C-224 | uncovered (not-run) | stopped before this check: timed out after 20 min waiting for the expiry or the reply |
| transfer | C-224 | uncovered (not-run) | stopped before this check: timed out after 20 min waiting for the expiry or the reply |
| disconnect | C-195, C-196 | uncovered (not-run) | stopped before this check: timed out after 20 min waiting for the expiry or the reply |
| supply-order | C-172, C-192, C-184 | uncovered (not-run) | stopped before this check: timed out after 20 min waiting for the expiry or the reply |

- P6 Q8 插话在第一个等待开着时发出；它让成员线多开了一个 Run（73442e11-5daa-4646-ab7c-850b5b01b4de），之后的到期链在这之后发生
- close and restart: SIGINT, exit 0 after 3595 ms
- restart: resumeOnStartup = ask
- stopped: not-run: timed out after 20 min waiting for the expiry or the reply
- g6-wait-mwvk9qpt-72 (RUNNING): pause because waiting ended: committed

## 撞墙表

| 时间 | 场景 | 哪一步 | 看到的拒绝原文和理由 | 类别 | 预期 | 建议包 |
|---|---|---|---|---|---|---|
| 2026-11-25T01:40:44.462Z | E05 | tool submit_initial_plan (call call-b86f67f1-c1fc-4dc1-a356-f4d9a8efccdb) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T01:42:19.096Z | E05 | tool edit (call call_598b10b92b6d4cc0b782866a) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 无理由 | - | 待定 |
| 2026-11-25T01:42:19.152Z | E05 | tool edit (call call_3e28b1db9ad94bb0882a13d6) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 无理由 | - | 待定 |
| 2026-11-25T01:42:23.866Z | E05 | tool edit (call call_9caf095c075e4ca6ae73379c) | execution_failed: test/users.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-25T01:42:23.927Z | E05 | tool edit (call call_25defe4dc8624db4adde158e) | execution_failed: test/rules.test.js 不存在 | 产品规则 | - | 待定 |
| 2026-11-25T01:42:40.211Z | E05 | tool record_note (call call_c59dc532a7194af69a78f880) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "basisNote" | 无理由 | - | 待定 |
| 2026-11-25T01:46:08.514Z | E05 | tool read (call call_67f0454a57134a458de9361f) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-25T01:48:42.063Z | E06 | tool submit_plan_round (call call_d6f56c06c29d4395bb68714a) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase"; plan.tasks.3: Unrecognized key: "phase" | 无理由 | - | 待定 |
| 2026-11-25T01:48:53.915Z | E06 | tool submit_plan_round (call call_0585bd5f1af1491a9d91e429) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T01:49:44.232Z | E06 | tool record_note (call call_b54df499a7c44724a99d4726) | invalid_arguments: 工具参数不符合 schema：topic: Invalid input: expected string, received undefined; conclusion: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-25T01:50:27.942Z | E06 | tool record_note (call call_85c849eec2274d97a525f30d) | invalid_arguments: 工具参数不符合 schema：topic: Invalid input: expected string, received undefined; conclusion: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-25T01:51:20.754Z | E06 | tool look_graph (call call_6d548586d70b4c96a87f46ee) | invalid_arguments: 工具参数不符合 schema：target.kind: Invalid discriminator value. Expected 'goal' \| 'stage' \| 'task' \| 'module' \| 'session' \| 'run' \| 'round' | 无理由 | - | 待定 |
| 2026-11-25T01:51:38.421Z | E06 | tool submit_plan_round (call call_be751cbeb01e444d92ce7fdf) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T01:51:50.754Z | E06 | tool submit_plan_round (call call_d76b305aa3dd4b53a2250f1b) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase"; plan.tasks.3: Unrecognized key: "phase" | 无理由 | - | 待定 |
| 2026-11-25T01:52:47.806Z | E06 | tool find_graph (call call_0b6922900e84433d938afc56) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "memotype" | 无理由 | - | 待定 |
| 2026-11-25T01:56:08.854Z | E06 | tool look_graph (call call_d171b4ed634d4ba1b5a33fa9) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-25T01:56:20.306Z | E06 | tool ask_person (call call_ff9674cc6e9d4b059265b75f) | invalid_arguments: 工具参数不符合 schema：objects.1.pin.ref: Unrecognized key: "planId"; (根): Unrecognized key: "objectives" | 无理由 | - | 待定 |
| 2026-11-25T01:56:28.191Z | E06 | tool ask_person (call call_3e7894f1cf3640c2b1ad1878) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "objects_note" | 无理由 | - | 待定 |
| 2026-11-25T02:29:43.107Z | E08 | tool read (call call_07294af698de453a8d40b334) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-25T02:29:43.280Z | E08 | tool run_readonly_command (call call_f7fdbd0b01ba4d23bf076856) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-25T02:30:00.107Z | E08 | tool submit_initial_plan (call call_f030e0c35f334b338c32ad91) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T02:30:15.678Z | E08 | tool submit_initial_plan (call call_352291598bd544f482c28c8e) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan.executionDag.dependsOn.0.taskId: Invalid input: expected string, received undefined; planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-25T02:30:35.407Z | E08 | core/goals/confirm-draft confirm-again-mwviaufj-25 | revision_conflict: the draft already created a goal; one card never makes two goals | 协调 | expected | 待定 |
| 2026-11-25T02:30:35.419Z | E08 | core/goals/control goals-control-mwviaufv-26 | invalid: meta.expected must pin the Goal and its GoalPhase (0 = none stored) | 产品规则 | expected | 待定 |
| 2026-11-25T02:31:26.493Z | E08 | tool edit (call call_bc5743fd723146259b089a73) | execution_failed: test/mul.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-25T03:01:44.068Z | E09 | tool list_files (call call-3c8e2785-1094-4e88-b7a7-078543636085) | invalid_arguments: 工具参数不符合 schema：prefix: Too small: expected string to have >=1 characters; prefix: Use a workspace-relative path | 无理由 | - | 待定 |
| 2026-11-25T03:02:17.310Z | E09 | tool submit_initial_plan (call call-284b5867-4897-49a9-85c5-90647f564c2f) | invalid_arguments: 工具参数不符合 schema：plan: Invalid input: expected object, received undefined; setup.architecture: Unrecognized keys: "completionPolicy", "checks"; setup.completionPolicy: Invalid input: expected object, received undefined; setup.checks: Invalid input: expected array, received undefined; setup: Unrecognized key: "plan" | 无理由 | - | 待定 |
| 2026-11-25T03:02:40.548Z | E09 | tool submit_initial_plan (call call-93613d3e-abe2-4937-a662-528e0e744a01) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T03:03:10.510Z | E09 | tool submit_initial_plan (call call-cc375dae-7138-4f6e-9496-a91f007feb7d) | invalid_arguments: 工具参数不符合 schema：plan.executionDag.dependsOn.0.requires: Invalid input: expected object, received undefined; plan.executionDag.dependsOn.1.requires: Invalid input: expected object, received undefined; plan.executionDag.dependsOn.2.requires: Invalid input: expected object, received undefined; plan.executionDag.dependsOn.3.requires: Invalid input: expected object, received undefined | 产品规则 | - | 待定 |
| 2026-11-25T03:03:38.948Z | E09 | tool submit_initial_plan (call call-d334dfcb-0178-4037-9bac-248ec5ea6eb9) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T03:05:21.672Z | E09 | tool read (call chatcmpl-tool-98ffaa0e9b942b80) | execution_failed: src 不是普通文件 | 无理由 | - | 待定 |
| 2026-11-25T03:05:23.375Z | E09 | tool read (call call_2a7b7c52db1446d2bec9e2e0) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-25T03:05:27.772Z | E09 | tool edit (call call_00_gllOEzA3tHfTRQ4lwbqn8269) | invalid_arguments: 工具参数不符合 schema：expectedRevision: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-25T03:05:31.471Z | E09 | tool read_user_decision (call call_694a5d67407f4a7682d0d6e8) | invalid: the decision source key is not parseable JSON | 无理由 | - | 待定 |
| 2026-11-25T03:05:31.734Z | E09 | tool look_graph (call chatcmpl-tool-8f50e87eb6088b74) | invalid: a path target supports only the card relation | 无理由 | - | 待定 |
| 2026-11-25T03:05:43.811Z | E09 | tool read_session_inbox (call call_61a3308eb6a24d66819d397e) | invalid_arguments: 工具参数不符合 schema：page: Unrecognized key: "status" | 无理由 | - | 待定 |
| 2026-11-25T03:07:10.198Z | E09 | tool record_note (call call_87d606333abb45eda83cc0fc) | invalid_arguments: 工具参数不符合 schema：op: Invalid discriminator value. Expected 'write' \| 'review' \| 'withdraw' | 无理由 | - | 待定 |
| 2026-11-25T03:07:55.827Z | E12 | tool submit_initial_plan (call call_216a0262b02f4b4eb70d8a3a) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T03:08:19.699Z | E12 | tool run_readonly_command (call call_3d8922cbea5e471f8df891da) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-25T03:08:27.909Z | E12 | tool dispatch_task (call call_04d15316a61d4ce484ab5216) | busy: the Task is in progress; its lease is still held by a running Run | 协调 | - | 待定 |
| 2026-11-25T03:08:39.049Z | E12 | tool edit (call call_ddeaa4974d1745b789294377) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 无理由 | - | 待定 |
| 2026-11-25T03:08:42.330Z | E12 | tool edit (call call_36e9adeb06a648679852460e) | execution_failed: test/greet.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-25T03:10:52.328Z | E12 | tool submit_plan_round (call call_4109307f68d2463abdf4e474) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase" | 无理由 | - | 待定 |
| 2026-11-25T03:12:06.286Z | iteration | tool submit_initial_plan (call call_854ad4f7b98d466ea6bd4afb) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T03:12:21.437Z | iteration | tool submit_initial_plan (call call_561efeca8067452eb478d348) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T03:12:34.812Z | iteration | tool submit_initial_plan (call call_b56adcaef99244ef9401f2ce) | invalid_arguments: 工具参数不符合 schema：setup.checks.2.kind: Invalid option: expected one of "static"\|"dynamic" | 无理由 | - | 待定 |
| 2026-11-25T03:13:22.686Z | iteration | tool submit_plan_round (call call_94a8356fb10d4aaa85df9096) | invalid_arguments: 工具参数不符合 schema：plan.obligations: Invalid input: expected array, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-25T03:15:00.997Z | iteration | tool submit_plan_round (call call_de226c396b514c10922d40b5) | invalid_arguments: 工具参数不符合 schema：plan.obligations.0: Unrecognized key: "title_" | 无理由 | - | 待定 |
| 2026-11-25T03:15:14.307Z | iteration | tool submit_plan_round (call call_c0b58972cb8e4891b8ef7a3c) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T03:15:29.207Z | iteration | tool submit_plan_round (call call_34868775a0cc439f961191b9) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-25T03:17:34.166Z | iteration | core/goals/control goals-control-mwvjz9ee-55 | revision_conflict: the GoalPhase changed since the caller read it | 协调 | - | 待定 |
| 2026-11-25T03:17:50.320Z | intervention | tool look_graph (call call_59df2ed9c6934f90a74581e1) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-25T03:18:02.175Z | intervention | tool submit_initial_plan (call call_e2ebe0b9034c40809c60d2e5) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-25T03:18:48.237Z | intervention | tool run_readonly_command (call call_24ac2c88857e4a1dabc13c8e) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-25T03:19:03.689Z | intervention | tool read (call call_f5095fddc2434538879df458) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-25T03:19:07.643Z | intervention | tool edit (call call_22f1ef1e76dc4adcb740c9cf) | execution_failed: test/lower.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-25T03:19:19.340Z | intervention | tool record_note (call call_8334d1891d2d47788c35a6e5) | invalid_arguments: 工具参数不符合 schema：topic: Invalid input: expected string, received undefined; conclusion: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-25T03:20:12.993Z | intervention | tool submit_plan_round (call call_429d6e0ff3d84b77ae1cb251) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-25T03:20:28.614Z | intervention | tool submit_plan_round (call call_e8a37fab41cb4de29de3e3e7) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-25T03:20:41.991Z | intervention | tool submit_plan_round (call call_69cccd1235784013afe52135) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T03:21:29.978Z | intervention | tool run_readonly_command (call call_e0dbbbf809544656a39ceb95) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-25T03:21:43.366Z | intervention | tool shell (call call_6328c6b2539b4be98a94de3d) | approval_denied: 审批后 workspace 已变化，请重新确认操作 | 无理由 | - | 待定 |
| 2026-11-25T03:24:11.776Z | waiting | tool look_graph (call call_2b611323a3aa4f69903716a8) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-25T03:24:14.661Z | waiting | tool look_graph (call call_131ffb13a1794749ba858106) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-25T03:24:32.480Z | waiting | tool submit_initial_plan (call call_bb8544955f564dcbb53f4207) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-25T03:24:41.286Z | waiting | tool submit_initial_plan (call call_4a86f3a41977453b8041e629) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T03:25:29.994Z | waiting | tool submit_plan_round (call call_083b3a9771ee49958e5e0940) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase" | 无理由 | - | 待定 |
| 2026-11-25T03:28:57.889Z | waiting | tool read_session_message (call call_cb60f3cc33c446c199c0a504) | forbidden: this message is not addressed to or sent by the caller Session | 无理由 | - | 待定 |
| 2026-11-25T03:49:10.428Z | E08b | tool read (call call_ff70f360ba9b454da0336ada) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-25T03:49:14.796Z | E08b | tool dispatch_task (call call_213aa52fb2ba479c9a4bf5fe) | not_found: goal c0000000025 does not exist | 无理由 | - | 待定 |
| 2026-11-25T03:50:34.338Z | E08b | tool run_readonly_command (call call_1aaaccd270764484847f91fc) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-25T03:50:50.562Z | E08b | tool edit (call call_faf0d59769a944428dd74768) | execution_failed: test/sub.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-25T03:50:51.783Z | E08b | tool record_note (call call_11990b8fcfc547b5b9b22a37) | invalid_arguments: 工具参数不符合 schema：op: Invalid discriminator value. Expected 'write' \| 'withdraw' | 无理由 | - | 待定 |
| 2026-11-25T03:50:54.492Z | E08b | tool edit (call call_b37c56ed7f5948d78694a3e6) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 无理由 | - | 待定 |
| 2026-11-25T03:51:12.924Z | E08b | tool look_graph (call call_2bb1e5d64f55460a8c5b47ca) | invalid: a path target supports only the card relation | 无理由 | - | 待定 |
| 2026-11-25T03:51:27.058Z | E08b | tool submit_plan_round (call call_504489839abe4e90b156e911) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized keys: "goalCardDrafts", "planDraftIndex", "planRevision" | 无理由 | - | 待定 |
| 2026-11-25T03:51:36.123Z | E08b | tool read (call call_b535a2f8b41b4fd0a70d1c7a) | execution_failed: .workbench 不是普通文件 | 无理由 | - | 待定 |
| 2026-11-25T03:51:36.138Z | E08b | tool look_graph (call call_2faea3052d4943999af63771) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-25T03:51:39.358Z | E08b | tool submit_plan_round (call call_204d700d64204d9a8af0a7b6) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-25T03:51:42.312Z | E08b | tool record_note (call call_59a612cd7ee14125a5f294d3) | invalid_arguments: 工具参数不符合 schema：op: Invalid discriminator value. Expected 'write' \| 'review' \| 'withdraw' | 无理由 | - | 待定 |
| 2026-11-25T03:51:53.090Z | E08b | tool respond_session_message (call call_03830b81486f46a9844f2f4c) | forbidden: only the Host may settle this source | 无理由 | - | 待定 |

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

### E08b：pass

- sub-running（C-210）：pass。提交改需求时 sub（t1）的 Run 8ea78738-2549-4b67-ab65-71f2e11cba31 正在跑（开始于 2026-11-25T03:50:39.834Z）
- stop-delivered（C-210）：pass。任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；请求 released（secretary 线 session-0689697b1c39d88cc8560d96678d35d4c33cc12e43ff3c5956155950ae79ca73，停 Run 8ea78738-2549-4b67-ab65-71f2e11cba31）
- safe-point-end（C-210）：pass。叫停送到后 sub 的 Run 8ea78738-2549-4b67-ab65-71f2e11cba31 结束（completed @ 2026-11-25T03:51:30.501Z），采用时没有 busy 硬停；任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；请求 released（secretary 线 session-0689697b1c39d88cc8560d96678d35d4c33cc12e43ff3c5956155950ae79ca73，停 Run 8ea78738-2549-4b67-ab65-71f2e11cba31）
- adopt-after-end（C-210）：pass。sub 的 Run 结束 2026-11-25T03:51:30.501Z；采用 initial-plan-8fdac60a0578a53342fe540428a4f69a @ 2026-11-25T03:51:55.842Z（人 plans/apply，busy 0 次）；记录 active→cancelled，setIn initial-plan-8fdac60a0578a53342fe540428a4f69a@-（采用 initial-plan-8fdac60a0578a53342fe540428a4f69a），actor human/g6-person；候选 adoptedBy human/g6-person
- 采用前：叫停请求 action_request.stop:a1444dd9934047ad0821ee64e44f33a59641f8caa19a549dae646121a2bc5494 released；任务卡上的步骤 requested → hold_placed → sent → delivered → run_ended；sub 的 Run 已结束 2026-11-25T03:51:30.501Z（completed）
- goal-confirm:goal.confirmDraft:a3560dc548d7c8c4a8cf7cc3fdd1cb895beefa82147f823ff093487537539197 (RUNNING): pause because E08b ended: committed

## 预算

- 上限：总量 380000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 22447631（输入 22230764，输出 216867；缓存命中 19379968）；Query 请求 272 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 28 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 实报输入（平台报了用量的部分，不含按预留上限计的和未计费 0）：22230764；估算部分 0。
- 超预算退出：整轮 没有；按场景/格 没有。
- E05：用量 4112294（输入 4085528，输出 26766，缓存命中 3460352；Query 请求 56（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 3；实报输入 4085528）
- E06：用量 5870243（输入 5820973，输出 49270，缓存命中 5256960；Query 请求 55（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 6；实报输入 5820973）
- E08：用量 848528（输入 838491，输出 10037，缓存命中 672896；Query 请求 13（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 838491）
- E09：用量 2538810（输入 2510181，输出 28629，缓存命中 2188672；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 3；实报输入 2510181）
- E12：用量 1206004（输入 1193374，输出 12630，缓存命中 1007872；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1193374）
- iteration：用量 1678601（输入 1651711，输出 26890，缓存命中 1416064；Query 请求 29（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1651711）
- intervention：用量 2861227（输入 2828688，输出 32539，缓存命中 2501376；Query 请求 33（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 2828688）
- waiting：用量 1336060（输入 1323456，输出 12604，缓存命中 1140480；Query 请求 22（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 6；实报输入 1323456）
- E08b：用量 1995864（输入 1978362，输出 17502，缓存命中 1735296；Query 请求 30（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1978362）
- P6 记账：模型调用 558 次（公开原历史里 `model.request_started` 的条数，含 Work Run；压缩摘要的请求在另一个 Kernel Session 里，数不到，照旧记作缺口）；叫醒轮（intervention-planning）31 个，其中只回“收到”的 1 个（成功的工具调用只有读类和 respond_session_message，没交候选、没发信、没出卡；裁定 Q11，只计数不判）。
- E05：模型调用 79，叫醒轮 6，只回收到 0
- E06：模型调用 177，叫醒轮 12，只回收到 0
- E08：模型调用 24，叫醒轮 1，只回收到 0
- E09：模型调用 56，叫醒轮 1，只回收到 0
- E12：模型调用 34，叫醒轮 1，只回收到 0
- iteration：模型调用 35，叫醒轮 1，只回收到 0
- intervention：模型调用 66，叫醒轮 3，只回收到 0
- waiting：模型调用 37，叫醒轮 4，只回收到 1
- E08b：模型调用 50，叫醒轮 2，只回收到 0

## 延迟探针

- w-accept#0：{"startedAt":"2026-11-25T01:40:19.985Z","writtenAt":"2026-11-25T01:49:20.121Z","samples":26013,"p50Ms":20.28,"p95Ms":21.36,"p99Ms":70.91,"maxMs":1104.15,"meanMs":22.07}；关闭 SIGINT, exit 0 after 651 ms
- w-accept#1：{"startedAt":"2026-11-25T01:49:20.194Z","writtenAt":"2026-11-25T03:09:07.947Z","samples":241450,"p50Ms":20.35,"p95Ms":21.5,"p99Ms":22.07,"maxMs":2554.33,"meanMs":21.13}；关闭 SIGINT, exit 0 after 114 ms
- w-accept#2：{"startedAt":"2026-11-25T03:09:08.020Z","writtenAt":"2026-11-25T03:26:15.629Z","samples":49958,"p50Ms":21.3,"p95Ms":21.84,"p99Ms":45.94,"maxMs":632.29,"meanMs":21.99}；关闭 SIGINT, exit 0 after 3595 ms
- w-accept#3：{"startedAt":"2026-11-25T03:28:50.293Z","writtenAt":"2026-11-25T03:51:57.339Z","samples":70681,"p50Ms":20.35,"p95Ms":21.61,"p99Ms":22.13,"maxMs":525.07,"meanMs":20.99}；关闭 SIGINT, exit 0 after 120 ms

## 其它记录

- 2026-11-25T03:51:57.367Z -: §6.2：Query 在“进入中”被中止由 qent 关成 not_entered（aborted_before_entry）；`queries/cancel` 在 entering 窗口仍回 not_running，本次不测、不判场景失败。
